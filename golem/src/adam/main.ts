/**
 * Adam's Body process (decision 0050): connects the bot through the connection manager (which
 * registers the life id first), starts the Body, and supervises it. When the bot disconnects or the
 * Body reports a fault, the run is stopped, the supervisor waits with backoff and starts the next
 * one, which takes the next `body_generation` and resumes from the checkpoint. SIGINT and SIGTERM
 * stop the run and leave the checkpoint. Every restart is logged as one JSON line.
 */
import { pathToFileURL } from 'node:url';
import { connectNats } from '@geldar/contract/nats';
import { jetstream } from '@nats-io/jetstream';
import type { Bot } from 'mineflayer';
import { type BackoffPolicy, DEFAULT_BACKOFF, nextDelayMs } from '../backoff.ts';
import { jetStreamPublisher } from '../body/records-nats.ts';
import { assertLoopbackNatsUrl, openRestartKv } from '../body/restart.ts';
import { loadStackConfig } from '../config.ts';
import { ConnectionManager } from '../connection.ts';
import { startGolemTelemetry } from '../metrics.ts';
import { natsRequestServer } from '../mind-link/server.ts';
import { golemNatsAuth } from '../nats-credentials.ts';
import { installFatalHandlers } from '../process-fatal.ts';
import { registryFromConfig } from '../registry.ts';
import { type AdamBodyEnv, type RunningAdamBody, startAdamBody } from './adam-body.ts';
import { loadAdamConfig } from './adam-config.ts';
import { BodyWatchdog } from './watchdog.ts';

/** An `acquire` error with this flag ends the supervisor instead of being retried. */
export class FatalBodyError extends Error {
  readonly fatal = true;
}

/** What the supervisor is built from. */
export interface SupervisorOptions {
  /** Resolves with a connected bot; rejects with the abort reason on `signal`. */
  acquire(signal: AbortSignal): Promise<Bot>;
  /** Starts one run of the Body on the bot. */
  start(bot: Bot): Promise<RunningAdamBody>;
  log: (line: Record<string, unknown>) => void;
  backoff?: BackoffPolicy;
  /** Waits `ms`; ends at once on `signal`. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  rng?: () => number;
  /** A run shorter than this does not reset the attempt counter. Default 10 000 ms. */
  stableMs?: number;
  /** Restarts a Body that is up but makes no progress; its history spans runs. */
  watchdog?: BodyWatchdog;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

/** Keeps one Body running: restarts it with backoff until `stop`. */
export class BodySupervisor {
  /** How many runs have been started. */
  starts = 0;
  /** True once a fatal connection error (a kick or ban) ended the loop; the caller then exits non-zero. */
  fatal = false;
  private readonly opts: SupervisorOptions;
  private readonly abort = new AbortController();
  private current: RunningAdamBody | null = null;
  private loop: Promise<void> | null = null;

  constructor(options: SupervisorOptions) {
    this.opts = options;
  }

  /** The Body that is up now, or null between runs. */
  get running(): RunningAdamBody | null {
    return this.current;
  }

  /** Starts supervising. The promise ends after `stop`, or when a fatal error ends it. */
  run(): Promise<void> {
    this.loop ??= this.supervise();
    return this.loop;
  }

  /** Stops the current run (the checkpoint stays) and ends the loop. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.loop;
  }

  private async supervise(): Promise<void> {
    const { log, now = Date.now, rng = Math.random } = this.opts;
    const sleep = this.opts.sleep ?? defaultSleep;
    const stableMs = this.opts.stableMs ?? 10_000;
    const { signal } = this.abort;
    let attempt = 0;
    while (!signal.aborted) {
      let reason: string;
      try {
        const bot = await this.opts.acquire(signal);
        if (signal.aborted) break;
        const body = await this.opts.start(bot);
        this.current = body;
        this.starts++;
        log({
          event: 'body_started',
          life_id: body.lifeId,
          body_generation: body.generation,
          outcome: body.outcome.kind,
        });
        const startedAt = now();
        const unwatch = this.opts.watchdog?.attach(body, (why) => body.fail(why));
        const stopped = new Promise<string>((resolve) =>
          signal.addEventListener('abort', () => resolve('stop requested'), { once: true }),
        );
        reason = await Promise.race([body.ended, stopped]);
        unwatch?.();
        this.current = null;
        await body
          .stop()
          .catch((error: unknown) => log({ event: 'body_stop_failed', error: String(error) }));
        if (now() - startedAt >= stableMs) attempt = 0;
      } catch (error) {
        this.current = null;
        if ((error as { fatal?: unknown }).fatal === true) {
          this.fatal = true;
          log({ event: 'body_fatal', error: String(error) });
          return;
        }
        reason = `start failed: ${String(error)}`;
      }
      if (signal.aborted) break;
      attempt++;
      const delayMs = nextDelayMs(attempt, this.opts.backoff ?? DEFAULT_BACKOFF, rng);
      log({ event: 'body_restart', reason, attempt, delay_ms: delayMs });
      await sleep(delayMs, signal);
    }
    log({ event: 'body_stopped' });
  }
}

/** The bot source for the supervisor: the first call connects, later calls wait for the next spawn. */
export function managerAcquire(manager: ConnectionManager): SupervisorOptions['acquire'] {
  let served: Bot | null = null;
  let first = true;
  return (signal) => {
    if (first) {
      first = false;
      return manager.start().then((bot) => (served = bot));
    }
    const fresh = (): Bot | null =>
      manager.state === 'online' && manager.bot !== null && manager.bot !== served
        ? manager.bot
        : null;
    return new Promise<Bot>((resolve, reject) => {
      const ready = fresh();
      if (ready !== null) {
        served = ready;
        return resolve(ready);
      }
      const cleanup = (): void => {
        manager.off('spawn', onSpawn);
        manager.off('fatal', onFatal);
        signal.removeEventListener('abort', onAbort);
      };
      const onSpawn = (bot: Bot): void => {
        cleanup();
        served = bot;
        resolve(bot);
      };
      const onFatal = (info: { reason: string }): void => {
        cleanup();
        reject(new FatalBodyError(`connection is fatal: ${info.reason}`));
      };
      const onAbort = (): void => {
        cleanup();
        reject(new Error('stop requested'));
      };
      manager.on('spawn', onSpawn);
      manager.on('fatal', onFatal);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}

const jsonLog = (line: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));
};

/** Runs Adam's Body until a signal. */
export async function main(): Promise<void> {
  const config = await loadAdamConfig();
  const stack = loadStackConfig();
  const natsUrl = stack.natsUrl ?? '';
  assertLoopbackNatsUrl(natsUrl);
  const nc = await connectNats({
    servers: natsUrl,
    name: 'adam-body',
    timeout: 5_000,
    ...golemNatsAuth(),
  });
  const restartKv = await openRestartKv(natsUrl);
  // Pushes only when GELDAR_TELEMETRY_URL is set; otherwise no timer and no request (decision 0088).
  const telemetry = startGolemTelemetry(process.env, {
    service: 'geldar-golem-adam',
    log: jsonLog,
  });
  const env: AdamBodyEnv = {
    config,
    kv: restartKv.kv,
    publisher: jetStreamPublisher(jetstream(nc)),
    server: natsRequestServer(nc),
    owners: nc,
    log: (line) => jsonLog({ event: 'body', life_id: config.lifeId, line }),
    metrics: telemetry.metrics,
  };
  const manager = new ConnectionManager({
    host: stack.mcHost,
    port: stack.mcPort,
    username: config.lifeId,
    registry: registryFromConfig(stack),
  });
  const supervisor = new BodySupervisor({
    acquire: managerAcquire(manager),
    start: (bot) => startAdamBody(env, bot),
    log: jsonLog,
    watchdog: new BodyWatchdog({
      log: jsonLog,
      limitMs: Number(process.env.GELDAR_BODY_WATCHDOG_MS) || 60_000,
    }),
  });
  const done = supervisor.run();
  const onSignal = (signal: string): void => {
    jsonLog({ event: 'signal', signal, life_id: config.lifeId });
    void supervisor.stop();
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  await done;
  await telemetry.stop();
  if (supervisor.fatal) process.exitCode = 1;
  await manager.stop();
  await restartKv.close();
  await nc.close();
}

/** Installs the host's fatal handlers (process-fatal.ts). The entry point calls it before the body starts. */
export function installEntryHandlers(): void {
  installFatalHandlers(jsonLog);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  installEntryHandlers();
  main().catch((error: unknown) => {
    jsonLog({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
