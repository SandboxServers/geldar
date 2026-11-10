/**
 * Seeds a running intent for Adam's life, so the resume case does not depend on the 8B choosing an
 * intent. The writes go through the Body's own code: the checkpoint through `CheckpointStore` (the
 * observer the executor calls after each step) and the intent's rows through `NatsRecordSink` (what
 * the Body publishes; eventsink projects them into `intents`). `openSeedDeps` needs the shard's NATS
 * (`GELDAR_IT=1`); the rest is pure over its buckets and publisher, so the unit test runs with fakes.
 */
import type { Thought } from '@geldar/contract';
import { jetstream } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import {
  type BodyKv,
  type CheckpointEntry,
  CheckpointStore,
  parseEntry,
} from '../../src/body/checkpoint.ts';
import {
  type EventPublisher,
  jetStreamPublisher,
  NatsRecordSink,
} from '../../src/body/records-nats.ts';
import { openRestartKv } from '../../src/body/restart.ts';
import { DEFAULT_STACK_NATS_URL } from '../../src/config.ts';

type Intent = NonNullable<Thought['intent']>;
type Position = { x: number; y: number; z: number };

/** How long the seed waits for NATS to take its intent rows before it gives up. */
const FLUSH_TIMEOUT_MS = 10_000;

/** The buckets and the publisher a seed writes through. */
export interface SeedDeps {
  /** The checkpoint bucket (`geldar-checkpoints`). */
  checkpoints: BodyKv;
  /** The generation bucket (`geldar-body-generation`), read for the running Body's generation. */
  generations: BodyKv;
  publisher: EventPublisher;
}

/** One running intent to seed. */
export interface SeedOptions {
  lifeId: string;
  shard: string;
  /** The generation of the Body the intent is seeded under: the one running now. */
  bodyGeneration: number;
  intentId: string;
  /** World tick at the seed. */
  tick: number;
  /** World tick from which the intent is past its `max_world_ticks`. */
  expiresTick: number;
  intent: Intent;
  /** The program's checkpoint, as its `checkpoint()` returns it. */
  checkpoint: CheckpointEntry['checkpoint'];
}

/** A `travel` intent to a position: the program the seed uses, with its arguments. */
export function travelIntent(target: Position): Intent {
  return {
    goal: 'walk_to_far_wall',
    program: 'travel',
    arguments: { target },
    wake_on: ['goal_completed'],
    limits: { max_world_ticks: 6000, max_block_operations: 100 },
  };
}

/**
 * Writes a running intent as the Body would have: its checkpoint first (a restarted Body resumes
 * it from there), then its `accepted` and `running` rows. Throws unless the checkpoint reads back as
 * an entry of this intent, since the store logs a failed write rather than throwing.
 */
export async function seedRunningIntent(
  deps: SeedDeps,
  options: SeedOptions,
): Promise<CheckpointEntry> {
  const { lifeId, intentId, bodyGeneration, tick, intent } = options;
  const store = new CheckpointStore({
    kv: deps.checkpoints,
    lifeId,
    bodyGeneration,
  });
  store.stepped({
    intentId,
    intent,
    checkpoint: options.checkpoint,
    blockOperationsUsed: 0,
    expiresTick: options.expiresTick,
  });
  await store.flush();
  const stored = await deps.checkpoints.get(lifeId);
  const entry = stored === null ? null : parseEntry(stored.value);
  if (entry === null || entry.intent_id !== intentId) {
    throw new Error(`the seeded checkpoint for ${lifeId} was not stored`);
  }

  const sink = new NatsRecordSink({
    publisher: deps.publisher,
    shard: options.shard,
    lifeId,
    worldTick: () => tick,
  });
  const change = { intentId, lifeId, bodyGeneration, tick };
  sink.intentChanged({ ...change, state: 'accepted', intent });
  sink.intentChanged({ ...change, state: 'running' });
  await flushWithin(sink, FLUSH_TIMEOUT_MS);
  return entry;
}

/** The generation the running Body took: the one `geldar-body-generation` holds for the life. */
export async function currentGeneration(generations: BodyKv, lifeId: string): Promise<number> {
  const record = await generations.get(lifeId);
  const value = record === null ? Number.NaN : Number(record.value);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`no body generation is stored for ${lifeId}`);
  }
  return value;
}

/**
 * Opens NATS and the Body's buckets for a seed, on the stack's loopback URL. The connection is
 * opened first so a failure leaves nothing open; `close` drops both.
 */
export async function openSeedDeps(
  natsUrl: string = process.env.GELDAR_NATS_URL ?? DEFAULT_STACK_NATS_URL,
): Promise<SeedDeps & { close(): Promise<void> }> {
  const nc = await connect({ servers: natsUrl, name: 'adam-seed', timeout: 5_000 });
  try {
    const restart = await openRestartKv(natsUrl);
    return {
      checkpoints: restart.kv.checkpoints,
      generations: restart.kv.generations,
      publisher: jetStreamPublisher(jetstream(nc)),
      async close() {
        await restart.close().catch(() => undefined);
        await nc.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await nc.close().catch(() => undefined);
    throw error;
  }
}

/** Waits for the sink to send what it holds, but not longer than `ms`. */
async function flushWithin(sink: NatsRecordSink, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the seeded intent did not reach NATS within ${ms} ms`)),
      ms,
    );
  });
  try {
    await Promise.race([sink.flush(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
