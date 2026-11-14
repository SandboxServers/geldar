/**
 * Builds the `PlanMessage` for a validated thought (spec 5.3.4 "publish the intent to the Body",
 * decision 0025). The ids are minted here, so a redelivered plan dedups in the Body.
 */
import type { PlanMessage, Snapshot, Thought } from '@geldar/contract';
import { newId } from '../ids.ts';

/** What `buildPlan` needs. */
export interface PlanInput {
  thought: Thought;
  /** The id of the thought that produced the plan. */
  thoughtId: string;
  /** The snapshot the thought was made from; the plan carries its id, revision and generation. */
  snapshot: Snapshot;
  /** `mind.plan.expires_after_ticks`. */
  expiresAfterTicks: number;
}

/**
 * True when `plan` has expired by the time it would be submitted: the snapshot's tick plus the
 * whole ticks elapsed since the snapshot was taken must reach `expires_tick`. `tickMs` is the
 * wall-clock length of one world tick, `1000 / tick_rate`.
 */
export function planExpiredBy(
  plan: PlanMessage,
  snapshotTick: number,
  elapsedMs: number,
  tickMs: number,
): boolean {
  return snapshotTick + Math.ceil(elapsedMs / tickMs) >= plan.expires_tick;
}

/**
 * The plan for `input.thought`: one `ac_` id per action in order, an `in_` id when the thought
 * starts an intent, and an expiry of the snapshot's tick plus the configured window. A snapshot
 * from a Body that sends no generation counts as generation 0.
 */
export function buildPlan(input: PlanInput): PlanMessage {
  const { thought, thoughtId, snapshot } = input;
  const plan: PlanMessage = {
    thought_id: thoughtId,
    life_id: snapshot.agent_id,
    body_generation: snapshot.body_generation ?? 0,
    source_snapshot_id: snapshot.snapshot_id,
    snapshot_revision: snapshot.revision,
    expires_tick: snapshot.world_time.ticks + input.expiresAfterTicks,
    // The generated type is a tuple of at most six; the thought schema caps actions at six.
    action_ids: (thought.actions ?? []).map(() => newId('ac')) as PlanMessage['action_ids'],
    thought,
  };
  if (thought.intent !== undefined) plan.intent_id = newId('in');
  return plan;
}
