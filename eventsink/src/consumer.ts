/** The durable pull consumer on GELDAR_EVENTS and the per-batch decision logic. */
import type { WorldEvent } from '@geldar/contract';
import {
  AckPolicy,
  jetstream,
  jetstreamManager,
  type JetStreamManager,
  type JsMsg,
  RetentionPolicy,
  StorageType,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { CONSUMER_NAME, STREAM_CONFIG } from './config.ts';
import { DLQ_TYPE, shardOfSubject, validateMessage } from './validate.ts';
import type { EventWriter } from './writer.ts';

/** The slice of a JetStream message the batch logic uses. */
export interface SinkMessage {
  subject: string;
  data: Uint8Array;
  /** How many times the server has delivered this message (1 on the first). */
  deliveryCount: number;
  ack(): void;
  nak(delayMs: number): void;
}

/** What `handleBatch` needs besides the messages. */
export interface BatchDeps {
  writer: EventWriter;
  /** Publishes a dead letter; resolves once JetStream has stored it. */
  publishDlq(subject: string, body: string): Promise<void>;
}

/** Nak delay for the nth delivery: 1 s, 2 s, 4 s ... capped at 30 s. */
export function nakDelayMs(deliveryCount: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, deliveryCount - 1));
}

/** The dead-letter subject for the shard a subject belongs to. */
export function dlqSubject(subject: string): string {
  return `geldar.${shardOfSubject(subject)}.${DLQ_TYPE}`;
}

/**
 * Decides every message in the batch.
 * - Dead letters (our own `geldar.<shard>.dlq`, stored in the same stream) are acked and skipped.
 * - Invalid messages are published to the DLQ with the reason, then acked; a DLQ failure naks.
 * - Valid ones are inserted in one transaction and acked only after it commits; a DB error naks them all.
 */
export async function handleBatch(
  messages: readonly SinkMessage[],
  deps: BatchDeps,
): Promise<void> {
  const valid: { message: SinkMessage; event: WorldEvent }[] = [];
  for (const message of messages) {
    if (message.subject.split('.')[2] === DLQ_TYPE) {
      message.ack();
      continue;
    }
    const verdict = validateMessage(message.subject, message.data);
    if (verdict.ok) {
      valid.push({ message, event: verdict.event });
      continue;
    }
    const body = JSON.stringify({
      reason: verdict.reason,
      subject: message.subject,
      data: new TextDecoder().decode(message.data),
    });
    try {
      await deps.publishDlq(dlqSubject(message.subject), body);
      message.ack();
    } catch {
      message.nak(nakDelayMs(message.deliveryCount));
    }
  }
  if (valid.length === 0) return;
  try {
    await deps.writer.insertBatch(valid.map((v) => v.event));
  } catch {
    for (const { message } of valid) message.nak(nakDelayMs(message.deliveryCount));
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
    });
  } catch (error) {
    // The plugin may have created it between the two calls.
    await jsm.streams.info(STREAM_CONFIG.name).catch(() => {
      throw error;
    });
  }
}

/** Adapts a JetStream message to the interface above. */
function toSinkMessage(m: JsMsg): SinkMessage {
  return {
    subject: m.subject,
    data: m.data,
    deliveryCount: m.info.deliveryCount,
    ack: () => m.ack(),
    nak: (delayMs) => m.nak(delayMs),
  };
}

/** A running consumer. */
export interface RunningConsumer {
  /** Stops fetching, finishes the batch in hand, then resolves. */
  stop(): Promise<void>;
}

/**
 * Binds the durable consumer (created if missing) and fetches batches until stopped.
 * `stop()` lets the current batch finish, so every fetched message is acked or naked before exit.
 */
export async function startConsumer(
  nc: NatsConnection,
  writer: EventWriter,
  options: { batchSize: number; fetchWaitMs: number },
): Promise<RunningConsumer> {
  const jsm = await jetstreamManager(nc);
  await ensureStream(jsm);
  await jsm.consumers.info(STREAM_CONFIG.name, CONSUMER_NAME).catch(() =>
    jsm.consumers.add(STREAM_CONFIG.name, {
      durable_name: CONSUMER_NAME,
      ack_policy: AckPolicy.Explicit,
      filter_subject: STREAM_CONFIG.subjects[0],
      ack_wait: 30 * 1_000_000_000,
    }),
  );
  const js = jetstream(nc);
  const consumer = await js.consumers.get(STREAM_CONFIG.name, CONSUMER_NAME);
  const deps: BatchDeps = {
    writer,
    publishDlq: async (subject, body) => {
      await js.publish(subject, body);
    },
  };

  let stopping = false;
  const loop = (async () => {
    while (!stopping) {
      try {
        const batch = await consumer.fetch({
          max_messages: options.batchSize,
          expires: options.fetchWaitMs,
        });
        const messages: SinkMessage[] = [];
        for await (const m of batch) messages.push(toSinkMessage(m));
        await handleBatch(messages, deps);
      } catch (error) {
        console.error('eventsink: fetch failed, retrying', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  })();
  return {
    async stop() {
      stopping = true;
      await loop;
    },
  };
}
