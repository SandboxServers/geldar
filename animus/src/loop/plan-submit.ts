/**
 * Sends a plan to the Body (spec 5.3.4). The expiry is checked first: a plan that would expire on
 * the way is refused here, not sent, and the loop decides that, not the Body. Split out of
 * thinking-loop.ts to keep that file under 500 lines.
 */
import { type PlanAck, type PlanMessage, validatePlanMessage } from '@geldar/contract';
import { type BodyLink, BodyLinkError } from '../ports/index.ts';
import { planExpiredBy } from './plan.ts';
import { type FailureReport, reportFailure } from './thought-journal.ts';

/** What a submission needs from the loop. */
export interface SubmitContext {
  body: BodyLink;
  lifeId: string;
  /** The wall-clock length of one world tick, `1000 / tick_rate`. */
  tickMs: number;
  now: () => number;
  report: FailureReport;
  log: (line: Record<string, unknown>) => void;
}

/** The Body refused a plan because it expired before it was sent; the loop decides, not the Body. */
function expiredRefusal(thoughtId: string): PlanAck {
  return {
    thought_id: thoughtId,
    accepted: false,
    rejection: { reason: 'expired', detail: 'the plan expired before it was submitted' },
  };
}

/** A refusal that a fresh snapshot can cure: the plan was built on a state that has moved on. */
export function isStaleRefusal(ack: PlanAck): boolean {
  const reason = ack.rejection?.reason;
  return reason === 'stale_generation' || reason === 'stale_snapshot' || reason === 'expired';
}

/**
 * Checks the plan's expiry against the snapshot's tick and the time since the snapshot was taken,
 * then sends it. Null when the plan could not be sent at all (see `submit`).
 */
export async function submitChecked(
  ctx: SubmitContext,
  plan: PlanMessage,
  thoughtId: string,
  snapshotTick: number,
  snappedAt: number,
): Promise<PlanAck | null> {
  if (planExpiredBy(plan, snapshotTick, ctx.now() - snappedAt, ctx.tickMs)) {
    return expiredRefusal(thoughtId);
  }
  return submit(ctx, plan);
}

/** A refused plan is logged with its reason; the rejection's detail text stays out of the log. */
export function noteRefusal(ctx: SubmitContext, thoughtId: string, ack: PlanAck): void {
  if (ack.accepted) return;
  ctx.log({
    event: 'plan_refused',
    life_id: ctx.lifeId,
    thought_id: thoughtId,
    reason: ack.rejection?.reason ?? 'unspecified',
  });
}

/**
 * Sends the plan. An ack that times out is sent once more (the Body dedupes by thought id). A
 * plan the contract rejects, or a Body that stays unreachable, gives null.
 */
async function submit(ctx: SubmitContext, plan: PlanMessage): Promise<PlanAck | null> {
  const checked = validatePlanMessage(plan);
  if (!checked.ok) {
    reportFailure(ctx.report, new Error('invalid plan'), 'invalid_plan', {
      thought_id: plan.thought_id,
    });
    return null;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await ctx.body.submitPlan(plan);
    } catch (error) {
      if (!(error instanceof BodyLinkError)) throw error;
      if (error.code !== 'timeout' || attempt >= 2) {
        reportFailure(ctx.report, error, error.code, { thought_id: plan.thought_id });
        return null;
      }
      ctx.log({
        event: 'plan_submit_retry',
        life_id: ctx.lifeId,
        thought_id: plan.thought_id,
        error_code: error.code,
      });
    }
  }
}
