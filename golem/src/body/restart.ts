import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import {
  type BodyKv,
  CHECKPOINT_BUCKET,
  type CheckpointEntry,
  CheckpointUnreadable,
  natsBodyKv,
} from './checkpoint.ts';
import { type Body, type CreateBodyOptions, createBody } from './create-body.ts';
import { GENERATION_BUCKET, type GenerationOptions, nextGeneration } from './generation.ts';

/** Spec 5.2: how long a restarted Body waits for the Mind's plan before it says it has none. */
export const NO_PLAN_WAIT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 5_000;
/** How long `stop` waits for the record sink to send what it holds before it gives up. */
const FLUSH_TIMEOUT_MS = 5_000;
/** How long a restart waits for the world tick to become known before it leaves the checkpoint. */
const TICK_WAIT_MS = 15_000;
const TICK_POLL_MS = 100;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** How a restart went. */
export type RestartOutcome =
  /** The saved intent runs again under the new generation. */
  | { kind: 'resumed'; intentId: string }
  /** Nothing to resume; `reason` says why. A `no_plan` wake follows if no plan arrives. */
  | {
      kind: 'idle';
      reason:
        | 'no_checkpoint'
        | 'checkpoint_unreadable'
        | 'other_life'
        | 'expired'
        | 'unknown_program'
        | 'resume_failed'
        | 'tick_unknown';
    };

/** What `restartBody` is built from: the Body's options, without the generation it takes itself. */
export interface RestartBodyOptions
  extends Omit<CreateBodyOptions, 'bodyGeneration' | 'checkpoints'> {
  /** The two buckets. */
  kv: { generations: BodyKv; checkpoints: BodyKv };
  /** Wait before the `no_plan` wake, in ms. Default `NO_PLAN_WAIT_MS` (45 s). */
  noPlanWaitMs?: number;
  /** Starts a timer and returns its cancel function; default `setTimeout`. */
  schedule?: (fire: () => void, ms: number) => () => void;
  generation?: GenerationOptions;
  log?: (line: string) => void;
  /** How long `stop` waits for the record sink to flush, in ms. Default 5000. */
  flushTimeoutMs?: number;
  /** How long to wait for the world tick before leaving a saved checkpoint alone. Default 15000. */
  tickWaitMs?: number;
}

/** A Body that has been through a restart: running, with the outcome of the recovery. */
export interface RestartedBody {
  body: Body;
  generation: number;
  outcome: RestartOutcome;
  /**
   * Stops the executor and runtime and waits for the last checkpoint write and for the record sink
   * to send what it holds (the `interrupted` event), up to `flushTimeoutMs`; the checkpoint stays.
   */
  stop(): Promise<void>;
}

/** Refuses a NATS URL that is not `nats://` on a loopback host (the Phase 0 rule, threat model). */
export function assertLoopbackNatsUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NATS URL must be a nats:// URL, got '${raw}'`);
  }
  if (url.protocol !== 'nats:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`NATS URL must be nats:// on 127.0.0.1 or localhost, got '${raw}'`);
  }
}

/**
 * Opens NATS and the two buckets (created when missing); `close` drops the connection. The URL
 * must be on loopback. The connection reconnects without end, waiting 1 s, 2 s, ... up to 15 s
 * between tries (the wait starts over after a successful reconnect).
 */
export async function openRestartKv(
  natsUrl: string,
): Promise<{ kv: RestartBodyOptions['kv']; close(): Promise<void> }> {
  assertLoopbackNatsUrl(natsUrl);
  let tries = 0;
  const nc = await connect({
    servers: natsUrl,
    name: 'golem-restart',
    timeout: CONNECT_TIMEOUT_MS,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectDelayHandler: () => Math.min(1_000 * 2 ** tries++, 15_000),
  });
  void (async () => {
    for await (const status of nc.status()) if (status.type === 'reconnect') tries = 0;
  })();
  try {
    const kvm = new Kvm(jetstream(nc));
    const generations = natsBodyKv(await kvm.create(GENERATION_BUCKET));
    const checkpoints = natsBodyKv(await kvm.create(CHECKPOINT_BUCKET));
    return { kv: { generations, checkpoints }, close: () => nc.close().then(() => undefined) };
  } catch (error) {
    await nc.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Starts a Body after a (re)start. It takes the life's next `body_generation`, builds the Body
 * with checkpointing on, starts its runtime and executor, then asks what it was doing: a saved
 * checkpoint of this life that has not expired and whose program is registered is resumed with
 * `resume(checkpoint)` and records an intent under the new generation (the intent keeps its
 * original expiry). Anything else leaves the Body idle, and when no plan has arrived after
 * `noPlanWaitMs` it raises a `no_plan` wake so the Mind is asked for one (spec 5.2).
 */
export async function restartBody(options: RestartBodyOptions): Promise<RestartedBody> {
  const generation = await nextGeneration(
    options.kv.generations,
    options.lifeId,
    options.generation,
  );
  const { kv, noPlanWaitMs, schedule, generation: _g, log, ...bodyOptions } = options;
  const body = createBody({
    ...bodyOptions,
    bodyGeneration: generation,
    checkpoints: { kv: kv.checkpoints, ...(log === undefined ? {} : { log }) },
  });
  body.runtime.start();
  body.executor.start();
  const outcome = await recover(body, options.lifeId, options.tickWaitMs ?? TICK_WAIT_MS);
  let cancel: () => void = () => undefined;
  if (outcome.kind === 'idle') {
    const plansBefore = body.executor.plansReceived;
    cancel = (schedule ?? afterMs)(() => {
      if (body.executor.plansReceived > plansBefore || body.executor.intentId !== null) return;
      body.runtime.sink.wake({
        reason: 'no_plan',
        tick: body.runtime.view.tick ?? 0,
        intentId: null,
        detail: 'restarted with nothing to resume and no plan arrived',
      });
    }, noPlanWaitMs ?? NO_PLAN_WAIT_MS);
  }
  return {
    body,
    generation,
    outcome,
    async stop() {
      cancel();
      await body.executor.stop();
      await body.runtime.stop();
      await body.checkpoints?.flush();
      await flushSink(body.records, options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS);
    },
  };
}

/** Loads the checkpoint and resumes it when it is usable; says why not otherwise. */
async function recover(body: Body, lifeId: string, tickWaitMs: number): Promise<RestartOutcome> {
  const store = body.checkpoints;
  let entry: CheckpointEntry | null = null;
  try {
    entry = store === null ? null : await store.load();
  } catch (error) {
    if (error instanceof CheckpointUnreadable) {
      return { kind: 'idle', reason: 'checkpoint_unreadable' };
    }
    throw error;
  }
  if (store === null || entry === null) return { kind: 'idle', reason: 'no_checkpoint' };
  // The bucket key is the life id, so a mismatch means the value was written for another life.
  if (entry.life_id !== lifeId) return { kind: 'idle', reason: 'other_life' };
  // Without a known world tick the expiry cannot be judged: wait for one, and leave the entry alone.
  const tick = await waitForTick(body, tickWaitMs);
  if (tick === null) return { kind: 'idle', reason: 'tick_unknown' };
  if (entry.expires_tick <= tick) {
    await store.discard();
    return { kind: 'idle', reason: 'expired' };
  }
  if (!body.runtime.programs.names().includes(entry.program)) {
    await store.discard();
    return { kind: 'idle', reason: 'unknown_program' };
  }
  const disposition = await body.executor.resume(
    resumedIntent(entry, tick),
    entry.intent_id,
    entry.block_operations_used,
  );
  return disposition === 'started'
    ? { kind: 'resumed', intentId: entry.intent_id }
    : { kind: 'idle', reason: 'resume_failed' };
}

/** The world tick once the view knows it, or null after `waitMs`. */
async function waitForTick(body: Body, waitMs: number): Promise<number | null> {
  for (let waited = 0; ; waited += TICK_POLL_MS) {
    const tick = body.runtime.view.tick;
    if (tick !== null && tick !== undefined) return tick;
    if (waited >= waitMs) return null;
    await new Promise((resolve) => setTimeout(resolve, TICK_POLL_MS));
  }
}

/** Waits for a sink that can flush to send what it holds, but not longer than `timeoutMs`. */
async function flushSink(sink: Body['records'], timeoutMs: number): Promise<void> {
  const flushable = sink as Body['records'] & { flush?: () => Promise<void> };
  if (typeof flushable.flush !== 'function') return;
  let cancel: () => void = () => undefined;
  const timeout = new Promise<void>((resolve) => {
    cancel = afterMs(resolve, timeoutMs);
  });
  await Promise.race([flushable.flush(), timeout]);
  cancel();
}

/**
 * The saved intent with its checkpoint, and only the world ticks it has left: never more than the
 * intent's own limit, so a world clock that went backwards cannot hand it extra time.
 */
function resumedIntent(entry: CheckpointEntry, tick: number): CheckpointEntry['intent'] {
  const { checkpoint: _old, ...intent } = entry.intent;
  return {
    ...intent,
    ...(entry.checkpoint === null ? {} : { checkpoint: entry.checkpoint }),
    limits: {
      ...intent.limits,
      max_world_ticks: Math.min(entry.expires_tick - tick, intent.limits.max_world_ticks),
    },
  };
}

/** `setTimeout` that does not keep the process alive; returns the cancel function. */
function afterMs(fire: () => void, ms: number): () => void {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => clearTimeout(timer);
}
