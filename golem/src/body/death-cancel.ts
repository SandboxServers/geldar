/** The executor's death hook: ends the running intent and action (see `IntentExecutor.endForDeath`). */
export interface DeathTarget {
  endForDeath(revision: number): Promise<void>;
}

/**
 * Cancels everything the previous life started, when its Body dies (not at the respawn: a step still
 * running would walk the new body back to the old target). The target ends the running intent through
 * the executor's end path, aborts the running action, and refuses plans made at or before `revision`.
 * The revision read here is the death's floor: a plan from a snapshot taken after the death carries a
 * higher revision and is accepted.
 */
export function cancelForDeath(target: DeathTarget, currentRevision: () => number): Promise<void> {
  return target.endForDeath(currentRevision());
}
