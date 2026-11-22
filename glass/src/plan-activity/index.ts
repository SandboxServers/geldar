/**
 * The plan-activity panel on Glass (decision 0429). This file is the registry stub: the panel is off and
 * draws nothing. BLD-37 fills the files under glass/src/plan-activity/ and turns the panel on.
 */

/** Off until BLD-37 ships the panel. */
export const PLAN_ACTIVITY_ENABLED = false;

/** Draws the plan-activity panel into `host`. While the panel is off it returns without touching `host`. */
export function renderPlanActivity(
  host: HTMLElement,
  enabled: boolean = PLAN_ACTIVITY_ENABLED,
): void {
  if (!enabled) return;
  host.textContent = '';
}
