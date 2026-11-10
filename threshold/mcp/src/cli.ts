import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { natsRequestTransport } from '@geldar/animus/src/link/nats-body-link.ts';
import { RealClock } from '@geldar/mcp-mock';
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import { Client, Pool } from 'pg';
import { repoRoot } from './config.ts';
import { safeLogLine } from './http/log.ts';
import {
  ConfigRejected,
  loadStartConfig,
  type McpPorts,
  type NatsLink,
  type PgOptions,
  type RunningMcp,
  startMcp,
} from './main.ts';

/** Exit codes: 0 stopped on a signal, 1 a runtime failure, 2 a usage error, 78 a configuration error. */
export const EXIT = { stopped: 0, failed: 1, usage: 2, config: 78 } as const;

export type Signal = 'SIGINT' | 'SIGTERM';

/** What the entry point reaches besides configuration: the server's ports, the signals and the exit. */
export interface CliDeps {
  ports: McpPorts;
  start?: (config: Parameters<typeof startMcp>[0], ports: McpPorts) => Promise<RunningMcp>;
  onSignal(signal: Signal, handler: () => void): void;
  log(line: Record<string, string | number>): void;
  setTimer(fn: () => void, ms: number): { unref: () => unknown };
}

/** What the shutdown handler needs; all injectable so tests can fake them. */
export interface ShutdownDeps {
  close: () => Promise<void>;
  log: (line: Record<string, string | number>) => void;
  exit: (code: number) => void;
  setTimer: (fn: () => void, ms: number) => { unref: () => unknown };
  /** How long a hung close may block the exit; defaults to 5000 ms. */
  forceExitMs?: number;
}

/**
 * The signal handler for a graceful stop. Only the first signal acts: a second one while close()
 * runs is ignored. A hung close() is cut short by an unref'd timer that exits 1.
 */
export function createShutdown(deps: ShutdownDeps): (signal: Signal) => void {
  const { close, log, exit, setTimer, forceExitMs = 5000 } = deps;
  let stopping = false;
  return (signal) => {
    if (stopping) return;
    stopping = true;
    log({ event: 'stopping', signal });
    setTimer(() => {
      log({ event: 'stop_failed', error: 'close timed out' });
      exit(1);
    }, forceExitMs).unref();
    close().then(
      () => exit(0),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'close failed';
        log({ event: 'stop_failed', error: message.slice(0, 200) });
        exit(1);
      },
    );
  };
}

/** The config file: the `file` argument, else GELDAR_SHARD_FILE, else `shards/<GELDAR_SHARD or phase0>.yaml`. */
export function configFileOf(argv: string[], env: Record<string, string | undefined>): string {
  const explicit = argv[3] ?? env.GELDAR_SHARD_FILE;
  if (explicit !== undefined) return explicit;
  return join(repoRoot(), 'shards', `${env.GELDAR_SHARD ?? 'phase0'}.yaml`);
}

/**
 * Runs `geldar-mcp start [file]`: loads the config (exit 78 when refused), starts the server (exit 1
 * when startup fails), then waits. The first SIGINT or SIGTERM stops it in order and exits 0. Resolves
 * with the exit code; the caller calls process.exit with it.
 */
export function runCli(
  argv: string[],
  env: Record<string, string | undefined>,
  deps: CliDeps,
): Promise<number> {
  const { log } = deps;
  if (argv[2] !== 'start') {
    log({ event: 'usage', expected: 'start [config-file]' });
    return Promise.resolve(EXIT.usage);
  }
  return new Promise<number>((resolve) => {
    const finish = (code: number) => resolve(code);
    void (async () => {
      let config: Awaited<ReturnType<typeof loadStartConfig>>;
      try {
        config = await loadStartConfig(configFileOf(argv, env), env);
      } catch (error) {
        const refused = error instanceof ConfigRejected;
        log({ event: refused ? 'config_rejected' : 'config_error', error: (error as Error).name });
        if (refused) log({ event: 'config_reason', reason: (error as Error).message });
        return finish(EXIT.config);
      }
      let running: RunningMcp;
      try {
        running = await (deps.start ?? startMcp)(config, deps.ports);
      } catch (error) {
        log({ event: 'startup_failed', error: (error as Error).name });
        return finish(EXIT.failed);
      }
      const shutdown = createShutdown({
        close: () => running.stop(),
        log,
        exit: finish,
        setTimer: deps.setTimer,
      });
      deps.onSignal('SIGINT', () => shutdown('SIGINT'));
      deps.onSignal('SIGTERM', () => shutdown('SIGTERM'));
    })();
  });
}

/** Ports for the container: the files, Postgres, NATS, the wall clock and a timer keepalive. */
export function containerPorts(shard: string): McpPorts {
  return {
    readSecret: async (path) => (await readFile(path, 'utf8')).trim(),
    openPool: (options: PgOptions) => new Pool({ ...options, max: 10 }),
    openRevokeListener: (config) => new Client(config),
    connectNats: (url) => connectNats(url, shard),
    keepAlive: {
      start(intervalMs, tick) {
        const handle = setInterval(tick, intervalMs);
        handle.unref();
        return () => clearInterval(handle);
      },
    },
    clock: new RealClock(),
    log: (line) =>
      process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`),
  };
}

/** The NATS link: one connection, the presence KV manager, request/reply, the call publisher and the replay. */
async function connectNats(url: string, shard: string): Promise<NatsLink> {
  const nc = await connect({ servers: url, name: 'geldar-mcp' });
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  const kvm = new Kvm(nc);
  return {
    request: natsRequestTransport(nc),
    buckets: {
      open: (name) => kvm.open(name) as never,
      create: (name) => kvm.create(name) as never,
    },
    publishCall: async (msgId, payload) => {
      await js.publish(`geldar.${shard}.sovereign_call`, JSON.stringify(payload), { msgID: msgId });
    },
    replay: async (subjects, fromIso, onMessage) => {
      const info = await jsm.consumers.add('GELDAR_EVENTS', {
        deliver_policy: DeliverPolicy.StartTime,
        opt_start_time: fromIso,
        ack_policy: AckPolicy.Explicit,
        filter_subjects: subjects,
        inactive_threshold: 300_000_000_000,
      });
      const consumer = await js.consumers.get('GELDAR_EVENTS', info.name);
      const messages = await consumer.consume();
      void (async () => {
        for await (const message of messages) {
          try {
            await onMessage(message.seq, message.json());
          } finally {
            message.ack();
          }
        }
      })();
      return { stop: async () => messages.stop() };
    },
    drain: async () => {
      await nc.drain();
    },
  };
}

/** The entry point when this file runs as the container's command. */
export async function main(): Promise<void> {
  const shard = process.env.GELDAR_SHARD ?? 'phase0';
  const log = containerPorts(shard).log;
  process.on('unhandledRejection', (error) => {
    log(safeLogLine({ event: 'unhandled', error: (error as Error).name }));
    process.exit(EXIT.failed);
  });
  const code = await runCli(process.argv, process.env, {
    ports: containerPorts(shard),
    onSignal: (signal, handler) => process.on(signal, handler),
    log,
    setTimer: (fn, ms) => setTimeout(fn, ms),
  });
  process.exit(code);
}

if (process.argv[1]?.endsWith('cli.ts')) {
  void main();
}
