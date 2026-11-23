/**
 * The plan-activity panel on Glass (decision 0429): a read-only list of plan counts for human viewers, one
 * line per builder. It is off until the body_actions.building gate and the operator feed turn it on; while
 * off it returns without touching `host`.
 */
import { type PlanActivityRow, planActivityLines } from './model.ts';

/** Off until the feed is wired to the building gate. */
export const PLAN_ACTIVITY_ENABLED = false;

/**
 * Draws the panel into `host`. Text is set with textContent, so a label or code can never become markup.
 * While `enabled` is false the host is not read or written.
 */
export function renderPlanActivity(
  host: HTMLElement,
  enabled: boolean = PLAN_ACTIVITY_ENABLED,
  rows: readonly PlanActivityRow[] = [],
): void {
  if (!enabled) return;
  host.textContent = planActivityLines(rows).join('\n');
}

export { type PlanActivityRow, toPlanActivityRow } from './model.ts';
