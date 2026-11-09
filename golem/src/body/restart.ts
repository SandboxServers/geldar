import { jetstream } from '@nats-io/jetstream';
import { Kvm } from '@nats-io/kv';
import { connect } from '@nats-io/transport-node';
import { type BodyKv, CHECKPOINT_BUCKET, type CheckpointEntry, natsBodyKv } from './checkpoint.ts';
import { type Body, type CreateBodyOptions, createBody } from './create-body.ts';
import { GENERATION_BUCKET, type GenerationOptions, nextGeneration } from './generation.ts';

/** Spec 5.2: how long a restarted Body waits for the Mind's plan before it says it has none. */
export const NO_PLAN_WAIT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 5_000;

/** How a restart went. */
export type RestartOutcome =
  /** The saved intent runs again under the new generation. */
  | { kind: 'resumed'; intentId: string }
  /** Nothing to resume; `reason` says why. A `no_plan` wake follows if no plan arrives. */
  | {
      kind: 'idle';
      reason: 'no_checkpoint' | 'other_life' | 'expired' | 'unknown_program' | 'resume_failed';
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
}

/** A Body that has been through a restart: running, with the outcome of the recovery. */
export interface RestartedBody {
  body: Body;
  generation: number;
  outcome: RestartOutcome;
  /** Stops the executor and runtime and waits for the last checkpoint write; the checkpoint stays. */
  stop(): Promise<void>;
}

/** Opens NATS and the two buckets (created when missing); `close` drops the connection. */
export async function openRestartKv(
  natsUrl: string,
): Promise<{ kv: RestartBodyOptions['kv']; close(): Promise<void> }> {
  const nc = await connect({
    servers: natsUrl,
    name: 'golem-restart',
    timeout: CONNECT_TIMEOUT_MS,
    reconnect: false,
  });
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
  const outcome = await recover(body, options.lifeId);
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
    },
  };
}

/** Loads the checkpoint and resumes it when it is usable; says why not otherwise. */
async function recover(body: Body, lifeId: string): Promise<RestartOutcome> {
  const store = body.checkpoints;
  const entry = store === null ? null : await store.load();
  if (store === null || entry === null) return { kind: 'idle', reason: 'no_checkpoint' };
  // The bucket key is the life id, so a mismatch means the value was written for another life.
  if (entry.life_id !== lifeId) return { kind: 'idle', reason: 'other_life' };
  const tick = body.runtime.view.tick ?? 0;
  if (entry.expires_tick <= tick) {
    await store.discard();
    return { kind: 'idle', reason: 'expired' };
  }
  if (!body.runtime.programs.names().includes(entry.program)) {
    await store.discard();
    return { kind: 'idle', reason: 'unknown_program' };
  }
  const disposition = await body.executor.resume(resumedIntent(entry, tick), entry.intent_id);
  return disposition === 'started'
    ? { kind: 'resumed', intentId: entry.intent_id }
    : { kind: 'idle', reason: 'resume_failed' };
}

/** The saved intent with its checkpoint, and only the world ticks it has left. */
function resumedIntent(entry: CheckpointEntry, tick: number): CheckpointEntry['intent'] {
  const { checkpoint: _old, ...intent } = entry.intent;
  return {
    ...intent,
    ...(entry.checkpoint === null ? {} : { checkpoint: entry.checkpoint }),
    limits: { ...intent.limits, max_world_ticks: entry.expires_tick - tick },
  };
}

/** `setTimeout` that does not keep the process alive; returns the cancel function. */
function afterMs(fire: () => void, ms: number): () => void {
  const timer = setTimeout(fire, ms);
  timer.unref();
  return () => clearTimeout(timer);
}
