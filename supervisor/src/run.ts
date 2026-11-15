// The supervisor's run loop (C7-03b5 review fix 2). main.ts is the process wrapper: it loads the config, connects,
// and registers the signals. What the shard's supervisor does while it runs, and in what order it stops, lives here
// over injected connection and pool, so the subjects, the exit codes and the shutdown order are tested.
//
// Shutdown order, which is what delivers in-flight replies: (1) the control subscription is drained, so no new
// request starts; (2) the in-flight answers settle, each publishing its reply and finishing its helper request over
// the still-open connection; (3) the connection drains; (4) the pool ends. Steps 1 and 2 share SHUTDOWN_TIMEOUT_MS;
// on timeout the process logs a fixed line and exits 1.
import {
  createHelperRuntime,
  type HelperRuntime,
  type NatsRequester,
  natsHelperRequest,
} from './helper-client.ts';
import { unexpectedEndLine } from './lifecycle.ts';
import { type CtlMsg, type CtlStats, type CtlWire, serveCtl } from './nats.ts';
import type { Supervisor } from './service.ts';

/** The longest the shutdown waits for the subscription to drain and the in-flight answers to settle. */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

/** A control subscription: its requests, and a drain that ends the stream after the buffered ones. */
export interface CtlSubscription extends AsyncIterable<CtlMsg> {
  drain(): Promise<void>;
}

/** The part of the NATS connection the run loop uses. */
export interface RunConnection extends NatsRequester {
  subscribe(subject: string): CtlSubscription;
  publish(subject: string, data: Uint8Array): void;
  drain(): Promise<void>;
}

export interface RunDeps {
  shard: string;
  nc: RunConnection;
  pool: { end(): Promise<void> };
  /** Builds the supervisor over the helper runtime, which this module makes for the shard. */
  buildSupervisor(runtime: HelperRuntime): Supervisor;
  /** Fixed lines to stderr. They name counters and states only, never a value. */
  log(line: string): void;
  exit(code: number): void;
  shutdownTimeoutMs?: number;
}

export interface RunHandle {
  /** Starts the shutdown. A call after the first is a no-op. */
  stop(): Promise<void>;
  /** Settles once the control loop has ended and any unexpected end has been reported and exited. */
  ended: Promise<void>;
}

/** Serves one shard's control subjects until a stop, or until the subscription ends on its own. */
export function runSupervisor(deps: RunDeps): RunHandle {
  const { shard, nc, pool, log, exit } = deps;
  const shutdownTimeoutMs = deps.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let stopping = false;
  let sub: CtlSubscription | undefined;
  const wire: CtlWire = {
    subscribe: (subject) => {
      sub = nc.subscribe(subject);
      return sub;
    },
    respond: async (inbox, data) => {
      nc.publish(inbox, data);
    },
  };
  const stats: CtlStats = {
    dropped: 0,
    invalid: 0,
    busy: 0,
    handlerFailed: 0,
    replyFailed: 0,
    subscribeFailed: 0,
  };
  const runtime = createHelperRuntime({ shard, request: natsHelperRequest(nc) });
  const supervisor = deps.buildSupervisor(runtime);
  log(`supervisor listening shard=${shard}`);
  const served = serveCtl({ wire, shard, supervisor, stats });

  // The subscription ended. During a stop that is the drain; otherwise the process would stay up answering nothing.
  const ended = served.then(() => {
    const line = unexpectedEndLine(stopping, stats);
    if (line === null) return;
    log(line);
    exit(1);
  });

  const drainAndSettle = async (): Promise<void> => {
    await sub?.drain();
    await served;
  };

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), shutdownTimeoutMs);
    });
    let outcome: 'settled' | 'timeout';
    try {
      outcome = await Promise.race([drainAndSettle().then(() => 'settled' as const), timeout]);
    } catch {
      clearTimeout(timer);
      log('supervisor: shutdown failed');
      exit(1);
      return;
    }
    clearTimeout(timer);
    if (outcome === 'timeout') {
      log('supervisor: shutdown timed out');
      exit(1);
      return;
    }
    try {
      await nc.drain();
      await pool.end();
    } catch {
      log('supervisor: shutdown failed');
      exit(1);
      return;
    }
    exit(0);
  };

  return { stop, ended };
}
