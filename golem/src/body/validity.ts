/** Why the Body refuses a plan (spec section 7, validity). */
export type RejectReason =
  /** The plan is for another life: a dead one, or a newborn's predecessor. */
  | 'wrong_life'
  /** The plan was made for another Body generation than this one. */
  | 'stale_generation'
  /** The plan's snapshot revision is older than the allowed window. */
  | 'stale_snapshot'
  /** The plan's `expires_tick` has passed. */
  | 'expired'
  /** The plan is malformed: it fails the thought schema, or its ids do not match its parts. */
  | 'invalid_plan';

/** A refused plan: the typed reason and a plain-text detail with the numbers. */
export interface Rejection {
  reason: RejectReason;
  detail: string;
}

/** The identity fields every plan, intent or action carries (spec section 7). */
export interface PlanIdentity {
  lifeId: string;
  bodyGeneration: number;
  snapshotRevision: number;
  expiresTick: number;
}

/** What the Body compares a plan with. */
export interface BodyIdentity {
  lifeId: string;
  bodyGeneration: number;
  /** The Body's current snapshot revision. */
  currentRevision: number;
  /** The current world tick. */
  tick: number;
}

/**
 * Default allowed snapshot-revision window: a plan made from a snapshot up to 2 revisions behind
 * the current one still runs. One in-flight thought per agent (spec 5.3.2) means a plan is
 * normally one revision behind by the time it lands; 2 leaves room for one more snapshot in between.
 */
export const DEFAULT_SNAPSHOT_WINDOW = 2;

/**
 * Checks a plan against the Body. Returns the first failure, in this order: life, generation,
 * snapshot revision, expiry; null when the plan may run. A generation that differs in either
 * direction is `stale_generation`: a plan from a generation the Body has not reached is as
 * untrustworthy as one from a past generation. A revision newer than the Body's own is accepted
 * (the Body's counter may lag the Mind's). A plan is expired from its `expires_tick` on.
 */
export function checkValidity(
  plan: PlanIdentity,
  body: BodyIdentity,
  snapshotWindow: number = DEFAULT_SNAPSHOT_WINDOW,
): Rejection | null {
  if (plan.lifeId !== body.lifeId) {
    return {
      reason: 'wrong_life',
      detail: `plan is for ${plan.lifeId}, body serves ${body.lifeId}`,
    };
  }
  if (plan.bodyGeneration !== body.bodyGeneration) {
    return {
      reason: 'stale_generation',
      detail: `plan generation ${plan.bodyGeneration}, body generation ${body.bodyGeneration}`,
    };
  }
  const behind = body.currentRevision - plan.snapshotRevision;
  if (behind > snapshotWindow) {
    return {
      reason: 'stale_snapshot',
      detail: `plan revision ${plan.snapshotRevision} is ${behind} behind ${body.currentRevision} (window ${snapshotWindow})`,
    };
  }
  if (body.tick >= plan.expiresTick) {
    return {
      reason: 'expired',
      detail: `expired at tick ${plan.expiresTick}, now ${body.tick}`,
    };
  }
  return null;
}
