import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { natsRequestTransport } from '@geldar/animus/src/link/nats-body-link.ts';
import { RealClock } from '@geldar/mcp-mock';
import {
  AckPolicy,
  DeliverPolicy,
  type JetStreamClient,
  type JetStreamManager,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
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
    // Raw text: the pepper keeps its spaces (pepperBytes strips only a final newline); main trims the password.
    readSecret: (path) => readFile(path, 'utf8'),
    // A stalled Postgres must fail a request, not hold its connection: every wait is bounded.
    openPool: (options: PgOptions) =>
      new Pool({
        ...options,
        max: 10,
        connectionTimeoutMillis: 5000,
        query_timeout: 5000,
        statement_timeout: 5000,
      }),
    openRevokeListener: (config) => new Client(config),
    connectNats: (url) => connectNats(url, shard, stderrLog),
    keepAlive: {
      start(intervalMs, tick) {
        const handle = setInterval(tick, intervalMs);
        handle.unref();
        return () => clearInterval(handle);
      },
    },
    clock: new RealClock(),
    log: stderrLog,
  };
}

/** One line of JSON on stderr, stamped with the time. */
export function stderrLog(line: Record<string, string | number>): void {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
}

/** The NATS link: one connection, the presence KV manager, request/reply, the call publisher and the replay. */
async function connectNats(
  url: string,
  shard: string,
  log: (line: Record<string, string | number>) => void,
): Promise<NatsLink> {
  const nc = await connect({ servers: url, name: 'geldar-mcp' });
  const js = jetstream(nc);
  const jsm = await jetstreamManager(nc);
  const kvm = new Kvm(nc);
  return {
    request: natsRequestTransport(nc),
    buckets: {
      create: (name) => kvm.create(name) as never,
    },
    publishCall: async (msgId, payload) => {
      await js.publish(`geldar.${shard}.sovereign_call`, JSON.stringify(payload), { msgID: msgId });
    },
    replay: (subjects, fromIso, onMessage) =>
      startReplay(jetStreamReplay(js, jsm), subjects, fromIso, onMessage, {
        log,
        waitMs: REPLAY_CATCHUP_MS,
      }),
    drain: async () => {
      await nc.drain();
    },
  };
}

/** The replay consumer on GELDAR_EVENTS: from the start time, on the subjects, explicit acks. */
function jetStreamReplay(js: JetStreamClient, jsm: JetStreamManager): ReplaySource {
  return {
    async open(subjects, fromIso) {
      const info = await jsm.consumers.add('GELDAR_EVENTS', {
        deliver_policy: DeliverPolicy.StartTime,
        opt_start_time: fromIso,
        ack_policy: AckPolicy.Explicit,
        filter_subjects: subjects,
        inactive_threshold: 300_000_000_000,
      });
      const consumer = await js.consumers.get('GELDAR_EVENTS', info.name);
      const messages = await consumer.consume();
      return { pending: info.num_pending, messages, stop: async () => messages.stop() };
    },
  };
}

/** How many deliveries of one stream message are tried before it is dropped (drop after four). */
export const MAX_STREAM_ATTEMPTS = 4;
/** The redelivery delay after the first, second and third failed try, in ms. */
export const STREAM_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;
/** How long the front door waits for the replay to catch up before it listens anyway. */
export const REPLAY_CATCHUP_MS = 30_000;
/** How many consecutive failed reopens of the replay consumer are tried before the process exits. */
export const RESTART_ATTEMPTS = 5;
/** How many first deliveries of stream sequences the replay remembers when it counts settled messages. */
const SEEN_LIMIT = 10_000;
/** How long a reopened consumer must stay open before its failures are forgotten, in ms. */
const HEALTHY_MS = 60_000;

/** One delivered stream message: its sequence, its body and the acknowledgement; a nak may set a delay. */
export interface StreamMessage {
  seq: number;
  json(): unknown;
  ack(): void;
  nak(delayMs?: number): void;
}

/** What the stream loop needs to reopen the consumer when its messages end without a stop request. */
export interface StreamRestart {
  reopen(): Promise<AsyncIterable<StreamMessage>>;
  stopping(): boolean;
  exit(code: number): void;
  sleep(ms: number): Promise<void>;
  /** Milliseconds on a clock that only moves forward; a consumer open for HEALTHY_MS resets the failures. */
  now(): number;
}

/** Counts of what the stream loop set aside: unparsable bodies, failed handlings and dropped messages. */
export interface StreamLoopCounters {
  malformed: number;
  failed: number;
  dropped: number;
}

/** The replay consumer as the replay needs it: what it holds at creation, and its messages. */
export interface ReplaySource {
  open(
    subjects: string[],
    fromIso: string,
  ): Promise<{ pending: number; messages: AsyncIterable<StreamMessage>; stop(): Promise<void> }>;
}

/**
 * Reads the stream until the iterator ends. A body that is not JSON is counted and acked. A handler
 * that throws is retried by a nak with a delay, and dropped and acked after MAX_STREAM_ATTEMPTS
 * deliveries. The loop never rejects: a throw is logged and the next message is read. `onSettled`
 * runs after each message is acked or naked, with its sequence. When the iterator ends or throws
 * without a stop request, `restart` reopens the consumer; without `restart` the loop returns.
 */
export async function runStreamLoop(
  messages: AsyncIterable<StreamMessage>,
  onMessage: (seq: number, raw: unknown) => Promise<void>,
  counters: StreamLoopCounters,
  log: (line: Record<string, string | number>) => void,
  onSettled?: (seq: number) => void,
  restart?: StreamRestart,
): Promise<void> {
  const attempts = new Map<number, number>();
  const failures = { count: 0 };
  let current = messages;
  let openedAt = restart?.now() ?? 0;
  for (;;) {
    try {
      for await (const message of current) {
        try {
          await settleOne(message, onMessage, counters, log, attempts);
        } catch (error) {
          log({ event: 'stream_message_unsettled', seq: message.seq, ...errorFields(error) });
        } finally {
          onSettled?.(message.seq);
        }
      }
    } catch (error) {
      log({ event: 'stream_loop_stopped', ...errorFields(error) });
    }
    if (restart === undefined || restart.stopping()) return;
    if (restart.now() - openedAt >= HEALTHY_MS) failures.count = 0;
    const next = await reopenOrExit(restart, failures, log);
    if (next === null) return;
    current = next;
    openedAt = restart.now();
  }
}

/**
 * Reopens the consumer after an unexpected end. Each try adds one to `failures.count`, which a healthy
 * run resets (see runStreamLoop), so a consumer that keeps ending right after a reopen keeps counting.
 * The tries wait 1 s, 2 s, 4 s, 8 s and then 16 s. At RESTART_ATTEMPTS failures it asks the process to
 * exit non-zero (so the container restarts) and resolves null; a stop request during a wait resolves
 * null without an exit.
 */
async function reopenOrExit(
  restart: StreamRestart,
  failures: { count: number },
  log: (line: Record<string, string | number>) => void,
): Promise<AsyncIterable<StreamMessage> | null> {
  for (;;) {
    if (restart.stopping()) return null;
    if (failures.count >= RESTART_ATTEMPTS) {
      log({ event: 'stream_loop_exhausted', attempts: RESTART_ATTEMPTS });
      restart.exit(1);
      return null;
    }
    failures.count++;
    await restart.sleep(Math.min(30_000, 1_000 * 2 ** (failures.count - 1)));
    if (restart.stopping()) return null;
    try {
      const messages = await restart.reopen();
      if (restart.stopping()) return null;
      log({ event: 'stream_loop_reopened', attempt: failures.count });
      return messages;
    } catch (error) {
      log({ event: 'stream_loop_reopen_failed', attempt: failures.count, ...errorFields(error) });
    }
  }
}

async function settleOne(
  message: StreamMessage,
  onMessage: (seq: number, raw: unknown) => Promise<void>,
  counters: StreamLoopCounters,
  log: (line: Record<string, string | number>) => void,
  attempts: Map<number, number>,
): Promise<void> {
  let raw: unknown;
  try {
    raw = message.json();
  } catch {
    counters.malformed++;
    log({ event: 'stream_message_malformed', seq: message.seq });
    message.ack();
    return;
  }
  try {
    await onMessage(message.seq, raw);
    attempts.delete(message.seq);
    message.ack();
  } catch (error) {
    const tries = (attempts.get(message.seq) ?? 0) + 1;
    counters.failed++;
    if (tries < MAX_STREAM_ATTEMPTS) {
      attempts.set(message.seq, tries);
      const delayMs = STREAM_RETRY_DELAYS_MS[tries - 1] ?? 0;
      log({
        event: 'stream_message_retry',
        seq: message.seq,
        attempt: tries,
        delay_ms: delayMs,
        ...errorFields(error),
      });
      message.nak(delayMs);
      return;
    }
    attempts.delete(message.seq);
    counters.dropped++;
    log({
      event: 'stream_message_dropped',
      seq: message.seq,
      attempts: tries,
      dropped_total: counters.dropped,
      ...errorFields(error),
    });
    message.ack();
  }
}

/**
 * Starts the replay and resolves once it has caught up: the consumer has settled the messages it held
 * at creation (a redelivery is not counted again), or `waitMs` has passed (logged as a timeout). The
 * loop keeps reading after that, and reopens the consumer if its messages end without a stop. The front
 * door listens only after this resolves, so a cursor is checked against a replayed head.
 */
export async function startReplay(
  source: ReplaySource,
  subjects: string[],
  fromIso: string,
  onMessage: (seq: number, raw: unknown) => Promise<void>,
  options: {
    log: (line: Record<string, string | number>) => void;
    waitMs: number;
    /** Ends the process when the consumer cannot be reopened; defaults to `process.exit`. */
    exit?: (code: number) => void;
    /** Waits between reopen attempts; defaults to a timer. */
    sleep?: (ms: number) => Promise<void>;
    /** Reads the clock for the healthy-run check; defaults to Date.now. */
    now?: () => number;
  },
): Promise<{ stop(): Promise<void> }> {
  const { log, waitMs } = options;
  const replay = await source.open(subjects, fromIso);
  const counters: StreamLoopCounters = { malformed: 0, failed: 0, dropped: 0 };
  let settled = 0;
  const seen = new Set<number>();
  let markCaughtUp: () => void = () => {};
  const caughtUp = new Promise<'caught_up'>((resolve) => {
    markCaughtUp = () => resolve('caught_up');
  });
  if (replay.pending <= 0) markCaughtUp();
  let stopping = false;
  let stopCurrent = replay.stop;
  const restart: StreamRestart = {
    reopen: async () => {
      const next = await source.open(subjects, fromIso);
      stopCurrent = next.stop;
      // A stop that landed while the consumer was opening never saw this one, so it stops it here.
      if (stopping) await next.stop();
      return next.messages;
    },
    stopping: () => stopping,
    exit: options.exit ?? ((code) => process.exit(code)),
    sleep: options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    now: options.now ?? (() => Date.now()),
  };
  void runStreamLoop(
    replay.messages,
    onMessage,
    counters,
    log,
    (seq) => {
      if (!firstDelivery(seen, seq)) return;
      settled++;
      if (settled >= replay.pending) markCaughtUp();
    },
    restart,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), waitMs);
  });
  const outcome = await Promise.race([caughtUp, timedOut]);
  clearTimeout(timer);
  if (outcome === 'timed_out') {
    log({ event: 'replay_catchup_timeout', settled, pending: replay.pending, waitMs });
  } else {
    log({ event: 'replay_caught_up', settled });
  }
  return {
    stop: async () => {
      stopping = true;
      await stopCurrent();
    },
  };
}

/** Whether `seq` is seen for the first time; the set keeps only the newest SEEN_LIMIT sequences. */
function firstDelivery(seen: Set<number>, seq: number): boolean {
  if (seen.has(seq)) return false;
  seen.add(seq);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as number);
  return true;
}

/** The log fields of an error: its name, and its `code` when it has one (a pg or NATS failure). */
function errorFields(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) return { error: 'unknown' };
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? { error: error.name, code }
    : { error: error.name };
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
