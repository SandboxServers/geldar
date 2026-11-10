/**
 * The replay's source on GELDAR_EVENTS. The stream is created by eventsink or the Geldar-Core plugin,
 * so the MCP may start before it exists. `untilStreamExists` waits for it instead of failing: 1 s
 * doubling to 30 s between tries, one info log a minute, and StreamWaitTimeout after STREAM_WAIT_MS.
 */
import {
  AckPolicy,
  DeliverPolicy,
  type JetStreamClient,
  type JetStreamManager,
} from '@nats-io/jetstream';
import type { ReplaySource } from './cli.ts';

/** The stream the replay reads: written by eventsink and the plugin, never by the MCP. */
export const EVENT_STREAM = 'GELDAR_EVENTS';
/** How long a missing stream is waited for before the replay gives up, in ms (5 minutes). */
export const STREAM_WAIT_MS = 300_000;
/** The least time between two "waiting" log lines, in ms. */
export const STREAM_WAIT_LOG_MS = 60_000;

/** The wait's logger and, for tests, its sleep and clock; the defaults are a timer and Date.now. */
export interface StreamWait {
  log(line: Record<string, string | number>): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

/** The stream stayed absent for STREAM_WAIT_MS: the caller ends the process (the container restarts). */
export class StreamWaitTimeout extends Error {
  constructor() {
    super('event stream absent');
    this.name = 'StreamWaitTimeout';
  }
}

/** Whether an error is NATS saying the stream is not there. */
export function isStreamMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'StreamNotFoundError' || error.message === 'stream not found')
  );
}

/**
 * Runs `open` until it succeeds. A missing stream is retried with a wait; any other error is thrown at
 * once. The first wait is 1 s, then 2 s, 4 s and so on to 30 s. The "waiting" line is logged at the
 * first miss and then at most once a minute. After STREAM_WAIT_MS of absence it logs and throws
 * StreamWaitTimeout.
 */
export async function untilStreamExists<T>(open: () => Promise<T>, wait: StreamWait): Promise<T> {
  const sleep =
    wait.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = wait.now ?? (() => Date.now());
  const since = now();
  let lastLogAt: number | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      return await open();
    } catch (error) {
      if (!isStreamMissing(error)) throw error;
      const at = now();
      const waitedMs = at - since;
      if (waitedMs >= STREAM_WAIT_MS) {
        wait.log({ event: 'event_stream_absent', stream: EVENT_STREAM, waited_ms: waitedMs });
        throw new StreamWaitTimeout();
      }
      if (lastLogAt === null || at - lastLogAt >= STREAM_WAIT_LOG_MS) {
        lastLogAt = at;
        wait.log({ event: 'waiting_for_event_stream', stream: EVENT_STREAM, waited_ms: waitedMs });
      }
      await sleep(Math.min(30_000, 1_000 * 2 ** (attempt - 1)));
    }
  }
}

/** The replay consumer on GELDAR_EVENTS: from the start time, on the subjects, explicit acks; waits for the stream. */
export function jetStreamReplay(
  js: JetStreamClient,
  jsm: JetStreamManager,
  wait: StreamWait,
): ReplaySource {
  return {
    open(subjects, fromIso) {
      return untilStreamExists(() => openConsumer(js, jsm, subjects, fromIso), wait);
    },
  };
}

async function openConsumer(
  js: JetStreamClient,
  jsm: JetStreamManager,
  subjects: string[],
  fromIso: string,
): ReturnType<ReplaySource['open']> {
  const info = await jsm.consumers.add(EVENT_STREAM, {
    deliver_policy: DeliverPolicy.StartTime,
    opt_start_time: fromIso,
    ack_policy: AckPolicy.Explicit,
    filter_subjects: subjects,
    inactive_threshold: 300_000_000_000,
  });
  const consumer = await js.consumers.get(EVENT_STREAM, info.name);
  const messages = await consumer.consume();
  return { pending: info.num_pending, messages, stop: async () => messages.stop() };
}
