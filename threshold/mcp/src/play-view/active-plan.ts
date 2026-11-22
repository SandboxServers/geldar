/**
 * The `active_plan` block of the status projection (BLD-S3b stub). It is null until the Body reports a
 * plan (BLD-S4 fills it from the plan_progress event and widens the type to the contract's
 * PlanProgressPayload; the contract index does not export that type yet). Status shows no plan while
 * this returns null.
 */
export function activePlanView(): null {
  return null;
}
