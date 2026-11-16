/** The durable pull consumer on GELDAR_EVENTS and the per-batch decision logic. */
import type { WorldEvent } from '@geldar/contract';
import { capText, type LogFields, scrubText } from '@geldar/telemetry';
import {
  AckPolicy,
  type Consumer,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { CONSUMER_NAME, STREAM_CONFIG } from './config.ts';
import { type EventsinkMetrics, type FailReason, samplePending } from './metrics.ts';
import { DLQ_TYPE, isNonEventSubject, shardOfSubject, validateMessage } from './validate.ts';
import { type EventWriter, isPermanentDbError } from './writer.ts';

/** The slice of a JetStream message the batch logic uses. */
export interface SinkMessage {
  subject: string;
  data: Uint8Array;
  /** How many times the server has delivered this message (1 on the first). */
  deliveryCount: number;
  /** The NATS headers; absent in tests that build messages by hand. `get` returns '' when a header is missing. */
  headers?: { get(name: string): string } | undefined;
  ack(): void;
  nak(delayMs: number): void;
}

/**
 * A W3C traceparent: `<2 hex version><32 hex trace id>-<16 hex parent id>-<2 hex flags>`, optionally
 * followed by more `-` segments (future versions). Version ff is invalid by W3C. Only lowercase hex.
 */
const TRACEPARENT = /^(?!ff)[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}(?:-.*)?$/;

/**
 * The trace id from the message's `traceparent` header, or null when the header is absent,
 * malformed, or its trace id or parent id is all zeros (which W3C defines as invalid).
 * Read directly; no telemetry import.
 */
export function traceIdOf(message: SinkMessage): string | null {
  const header = message.headers?.get('traceparent') ?? '';
  const match = TRACEPARENT.exec(header);
  if (match === null) return null;
  const trace = match[1] ?? '';
  const parent = match[2] ?? '';
  if (/^0+$/.test(trace) || /^0+$/.test(parent)) return null;
  return trace;
}

/** What `handleBatch` needs besides the messages. */
export interface BatchDeps {
  writer: EventWriter;
  /** Publishes a dead letter; resolves once JetStream has stored it. */
  publishDlq(subject: string, body: string): Promise<void>;
  /** Where errors and dead letters are reported; defaults to `console.error`. */
  log?(line: string): void;
  /** Counts what the batch decides; absent when no telemetry URL is set. */
  metrics?: EventsinkMetrics | undefined;
  /**
   * One OTLP error log per dead letter, failed DLQ publish, write nak or fetch failure. Fire and
   * forget: absent when no telemetry URL is set, and a throw from it is swallowed, so it never
   * reaches the ack, nak or DLQ path. Carries the subject, a scrubbed reason and the trace id,
   * never the event body.
   */
  errorLog?: ErrorLog | undefined;
}

/** The sink for the error logs: an event name and its fields. */
export type ErrorLog = (event: string, fields: LogFields) => void;

/** Longest `reason` sent in an error log. */
const ERROR_LOG_REASON_LIMIT = 2000;

/** The message facts an error log carries. */
interface LogContext {
  subject: string;
  deliveryCount: number;
  traceId: string | null;
}

/** Sends one error log, guarded: a failing logger never changes a decision. */
function report(
  errorLog: ErrorLog | undefined,
  event: string,
  reason: string,
  context?: LogContext,
): void {
  if (errorLog === undefined) return;
  try {
    const fields: LogFields = {
      reason: capText(scrubText(reason), ERROR_LOG_REASON_LIMIT).text,
    };
    if (context !== undefined) {
      fields.subject = context.subject.slice(0, 256);
      fields.trace_id = context.traceId;
      fields.delivery_count = context.deliveryCount;
    }
    errorLog(event, fields);
  } catch {
    // Telemetry is never allowed to break the consumer.
  }
}

/** Original payload bytes kept in a dead letter body; the rest is cut so it fits max_payload. */
export const DLQ_DATA_LIMIT = 8192;

/** Longest `reason` kept in a dead letter body. */
const DLQ_REASON_LIMIT = 2000;

/**
 * Server-side redelivery cap: -1 means unlimited. A transient failure (database down, connection
 * or timeout error) is always naked and redelivered, never dead-lettered, so an outage of any
 * length loses no event. Every message ends in an ack: stored, or dead-lettered as poison.
 */
export const MAX_DELIVER = -1;

/** Nak delay for the nth delivery: 1 s, 2 s, 4 s ... capped at 30 s. */
export function nakDelayMs(deliveryCount: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, deliveryCount - 1));
}

/** The dead-letter subject for the shard a subject belongs to. */
export function dlqSubject(subject: string): string {
  return `geldar.${shardOfSubject(subject)}.${DLQ_TYPE}`;
}

/**
 * The JSON body of a dead letter. The original data is cut to `DLQ_DATA_LIMIT` bytes and its full
 * byte length recorded, so the body never outgrows the server's max_payload.
 */
export function dlqBody(reason: string, subject: string, data: Uint8Array): string {
  return JSON.stringify({
    reason: reason.slice(0, DLQ_REASON_LIMIT),
    subject: subject.slice(0, 256),
    data: new TextDecoder().decode(data.subarray(0, DLQ_DATA_LIMIT)),
    data_bytes: data.byteLength,
    data_truncated: data.byteLength > DLQ_DATA_LIMIT,
  });
}

/**
 * True for the sink's own dead letters: a body on a `*.dlq` subject with no `source_event_id`.
 * An event whose type is `dlq` carries an id, so it is validated and stored like any other.
 */
function isOwnDeadLetter(message: SinkMessage): boolean {
  if (message.subject.split('.')[2] !== DLQ_TYPE) return false;
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(message.data));
    const id = (body as { source_event_id?: unknown } | null)?.source_event_id;
    return typeof id !== 'string';
  } catch {
    return true;
  }
}

/** The log context of a message; a header read that throws gives a null trace id, never an error. */
function contextOf(message: SinkMessage, traceId?: string | null): LogContext {
  let id: string | null = null;
  try {
    id = traceId === undefined ? traceIdOf(message) : traceId;
  } catch {
    // A malformed header object must not reach the DLQ path.
  }
  return { subject: message.subject, deliveryCount: message.deliveryCount, traceId: id };
}

/**
 * Publishes one dead letter and acks the message; a DLQ failure naks it instead. Only the acked
 * (terminal) outcome is counted, so a retried DLQ publish is not counted twice.
 */
async function deadLetter(
  message: SinkMessage,
  reason: string,
  kind: FailReason,
  deps: BatchDeps,
  log: (line: string) => void,
): Promise<void> {
  const dlq = dlqSubject(message.subject);
  try {
    await deps.publishDlq(dlq, dlqBody(reason, message.subject, message.data));
    log(
      `eventsink: ALERT dead letter published to ${dlq} for subject=${message.subject} reason=${reason.slice(0, 300)}`,
    );
    deps.metrics?.failed(kind);
    deps.metrics?.dlqWritten();
    report(deps.errorLog, 'dead_letter', reason, contextOf(message));
    message.ack();
  } catch (error) {
    log(`eventsink: DLQ publish failed subject=${message.subject}: ${String(error)}`);
    report(deps.errorLog, 'dlq_publish_failed', String(error), contextOf(message));
    message.nak(nakDelayMs(message.deliveryCount));
  }
}

/**
 * A transient failure (database down, connection or timeout) for one message: nak with capped
 * backoff. Never dead-letters: the event waits for the database however long the outage lasts.
 */
function retryLater(message: SinkMessage): void {
  message.nak(nakDelayMs(message.deliveryCount));
}

/** A message that passed validation, with its event and its trace id (null when it carried none). */
interface ValidMessage {
  message: SinkMessage;
  event: WorldEvent;
  traceId: string | null;
}

/** After a permanent batch error: one row at a time, so only the offending rows are dead-lettered. */
async function insertRowByRow(
  valid: readonly ValidMessage[],
  deps: BatchDeps,
  log: (line: string) => void,
): Promise<void> {
  for (const { message, event, traceId } of valid) {
    try {
      await deps.writer.insertBatch([event], [traceId]);
      deps.metrics?.written(1);
      message.ack();
    } catch (error) {
      if (isPermanentDbError(error)) {
        await deadLetter(
          message,
          `database rejected the event (${String((error as { code?: unknown }).code)}): ${(error as Error).message}`,
          'db',
          deps,
          log,
        );
      } else {
        log(`eventsink: write failed, nak ${event.source_event_id}: ${String(error)}`);
        report(deps.errorLog, 'write_failed_nak', String(error), contextOf(message, traceId));
        retryLater(message);
      }
    }
  }
}

/**
 * Decides every message in the batch.
 * - Own dead letters (`geldar.<shard>.dlq` bodies without a `source_event_id`) are acked and skipped.
 * - Non-event subjects (`geldar.<shard>.maintenance`) are acked and skipped, counted, never stored.
 * - Invalid messages are published to the DLQ with the reason, then acked; a DLQ failure naks.
 * - Valid ones are inserted in one transaction and acked only after it commits. A connection or
 *   timeout error naks them all, however many deliveries that takes. A permanent error (SQLSTATE
 *   22 or 23) retries row by row and dead-letters only the rows the database rejects.
 */
export async function handleBatch(
  messages: readonly SinkMessage[],
  deps: BatchDeps,
): Promise<void> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const valid: ValidMessage[] = [];
  for (const message of messages) {
    deps.metrics?.consumed(message.subject);
    if (isOwnDeadLetter(message)) {
      message.ack();
      continue;
    }
    if (isNonEventSubject(message.subject)) {
      deps.metrics?.skipped();
      log(`eventsink: skipped non-event message subject=${message.subject}`);
      message.ack();
      continue;
    }
    const verdict = validateMessage(message.subject, message.data);
    if (verdict.ok) {
      valid.push({ message, event: verdict.event, traceId: traceIdOf(message) });
      continue;
    }
    await deadLetter(message, verdict.reason, 'validate', deps, log);
  }
  if (valid.length === 0) return;
  try {
    await deps.writer.insertBatch(
      valid.map((v) => v.event),
      valid.map((v) => v.traceId),
    );
    deps.metrics?.written(valid.length);
  } catch (error) {
    if (isPermanentDbError(error)) {
      log(`eventsink: batch rejected (${String(error)}), retrying row by row`);
      await insertRowByRow(valid, deps, log);
      return;
    }
    const ids = valid.map((v) => v.event.source_event_id).join(',');
    log(`eventsink: write failed, nak ${valid.length} events [${ids}]: ${String(error)}`);
    for (const { message, traceId } of valid) {
      report(deps.errorLog, 'write_failed_nak', String(error), contextOf(message, traceId));
      retryLater(message);
    }
    return;
  }
  for (const { message } of valid) message.ack();
}

/** Creates GELDAR_EVENTS from the shared definition if it does not exist. */
export async function ensureStream(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.streams.info(STREAM_CONFIG.name);
    return;
  } catch {
    // Not found (or a transient error): try to create it below.
  }
  try {
    await jsm.streams.add({
      name: STREAM_CONFIG.name,
      subjects: [...STREAM_CONFIG.subjects],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      max_age: STREAM_CONFIG.retentionDays * 24 * 3600 * 1_000_000_000,
      max_bytes: STREAM_CONFIG.maxBytes,
    });
  } catch (error) {
    // The plugin may have created it between the two calls.
    await jsm.streams.info(STREAM_CONFIG.name).catch(() => {
      throw error;
    });
  }
}

/**
 * Creates the durable consumer if it does not exist, and lifts the redelivery cap on one created
 * with an older `max_deliver` (an outage longer than the cap would otherwise lose events).
 */
export async function ensureConsumer(jsm: JetStreamManager): Promise<void> {
  const existing = await jsm.consumers.info(STREAM_CONFIG.name, CONSUMER_NAME).catch(() => null);
  if (existing === null) {
    await jsm.consumers.add(STREAM_CONFIG.name, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      filter_subject: STREAM_CONFIG.subjects[0],
      ack_wait: 30 * 1_000_000_000,
      max_deliver: MAX_DELIVER,
    });
    return;
  }
  if (existing.config?.max_deliver !== MAX_DELIVER) {
    await jsm.consumers.update(STREAM_CONFIG.name, CONSUMER_NAME, { max_deliver: MAX_DELIVER });
  }
}

/** Adapts a JetStream message to the interface above. */
function toSinkMessage(m: JsMsg): SinkMessage {
  return {
    subject: m.subject,
    data: m.data,
    deliveryCount: m.info.deliveryCount,
    headers: m.headers,
    ack: () => m.ack(),
    nak: (delayMs) => m.nak(delayMs),
  };
}

/** A running consumer. */
export interface RunningConsumer {
  /** Stops fetching, finishes the batch in hand, then resolves. */
  stop(): Promise<void>;
}

/** Consecutive fetch failures before the stream and consumer are re-created. */
const REENSURE_AFTER = 5;

/** Consecutive fetch failures before giving up and letting the supervisor restart the process. */
const FATAL_AFTER = 20;

/** Ensures the stream and consumer, then returns the consumer handle. */
async function bindConsumer(nc: NatsConnection, js: JetStreamClient): Promise<Consumer> {
  const jsm = await jetstreamManager(nc);
  await ensureStream(jsm);
  await ensureConsumer(jsm);
  return js.consumers.get(STREAM_CONFIG.name, CONSUMER_NAME);
}

/**
 * Binds the durable consumer (created if missing) and fetches batches until stopped.
 * `stop()` lets the current batch finish, so every fetched message is acked or naked before exit.
 * After repeated fetch failures the stream and consumer are re-ensured (a deleted one is
 * re-created); if failures keep going, `onFatal` is called so the process can exit and restart.
 */
export async function startConsumer(
  nc: NatsConnection,
  writer: EventWriter,
  options: {
    batchSize: number;
    fetchWaitMs: number;
    onFatal?: (error: unknown) => void;
    /** Counts the batch decisions and samples the pending count; absent when telemetry is off. */
    metrics?: EventsinkMetrics | undefined;
    /** How often the pending count is sampled; 15 s by default. */
    lagIntervalMs?: number | undefined;
    /** The OTLP error log; absent when telemetry is off. */
    errorLog?: ErrorLog | undefined;
  },
): Promise<RunningConsumer> {
  const js = jetstream(nc);
  let consumer = await bindConsumer(nc, js);
  const deps: BatchDeps = {
    writer,
    publishDlq: async (subject, body) => {
      await js.publish(subject, body);
    },
    metrics: options.metrics,
    errorLog: options.errorLog,
  };
  const metrics = options.metrics;
  const lagTimer = metrics
    ? setInterval(() => void samplePending(metrics, consumer), options.lagIntervalMs ?? 15_000)
    : undefined;
  lagTimer?.unref();

  let stopping = false;
  const loop = (async () => {
    let failures = 0;
    while (!stopping) {
      try {
        if (failures >= REENSURE_AFTER && failures % REENSURE_AFTER === 0) {
          consumer = await bindConsumer(nc, js);
        }
        const batch = await consumer.fetch({
          max_messages: options.batchSize,
          expires: options.fetchWaitMs,
        });
        const messages: SinkMessage[] = [];
        for await (const m of batch) messages.push(toSinkMessage(m));
        await handleBatch(messages, deps);
        failures = 0;
      } catch (error) {
        failures++;
        console.error(`eventsink: fetch failed (${failures} in a row), retrying`, error);
        report(options.errorLog, 'fetch_failed', String(error));
        if (failures >= FATAL_AFTER) {
          options.onFatal?.(error);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  })();
  return {
    async stop() {
      stopping = true;
      clearInterval(lagTimer);
      await loop;
    },
  };
}
