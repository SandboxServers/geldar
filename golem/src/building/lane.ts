// The plan lane (BLD-13). BLD-S3a only creates the hook: the lane is absent in both flag states.

/** A running plan lane. BLD-13 gives it fields. */
export interface PlanLane {
  readonly kind: 'plan-lane';
}

/** Creates the lane while body_actions.building is on. Stub: returns null for both values. */
export function createPlanLane(_enabled: boolean): PlanLane | null {
  return null;
}

/** Resumes a saved plan after a restart. Stub: no-op until BLD-13. */
export function resumePlanLane(): void {
  // BLD-13 fills this in.
}
