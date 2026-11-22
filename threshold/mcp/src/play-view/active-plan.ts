import type { PlanProgressPayload } from '@geldar/contract';

/**
 * The `active_plan` block of the status projection (BLD-23). It is the plan's counts as the Body reported
 * them, copied field by field so no other field reaches a player; null when no plan runs. The payload holds
 * counts and the plan's own cell indexes only, never unseen block data.
 */
export function activePlanView(progress?: PlanProgressPayload | null): PlanProgressPayload | null {
  if (progress === undefined || progress === null) return null;
  return {
    plan_id: progress.plan_id,
    total: progress.total,
    done: progress.done,
    placed: progress.placed,
    broken: progress.broken,
    skipped_by_code: { ...progress.skipped_by_code },
    phase: progress.phase,
    ...(progress.next_need === undefined ? {} : { next_need: { ...progress.next_need } }),
  };
}
