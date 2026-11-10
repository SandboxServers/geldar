/**
 * Bounds one await of a thinking cycle. A step that runs past its limit ends the cycle with a
 * `CycleAborted` carrying a closed reason, so `handle` settles the thought and the next wake runs.
 * The abandoned work is not cancelled here; the cycle stops at the bound and never runs the steps
 * after it, so a late reply cannot submit a plan.
 */

/** The closed reasons a cycle can be aborted for, one per kind of awaited dependency. */
export type CycleAbortReason =
  | 'snapshot'
  | 'memory'
  | 'thinker'
  | 'journal'
  | 'plan_submit'
  | 'publish';

/**
 * The default limit of one step, in milliseconds. Generous next to the p95 of 15 s for a thought
 * and next to the dependencies' own bounds (the NATS request 5 s, the pool 10 s and 30 s).
 */
export const STEP_TIMEOUT_MS = 60_000;

/** A cycle step that did not finish within its limit. */
export class CycleAborted extends Error {
  readonly reason: CycleAbortReason;

  constructor(reason: CycleAbortReason, ms: number) {
    super(`${reason} did not finish in ${ms} ms`);
    this.name = 'CycleAborted';
    this.reason = reason;
  }
}

/** Waits for `work`, or rejects with `CycleAborted(reason)` after `ms`; the timer is cleared on settle. */
export async function bounded<T>(
  work: Promise<T>,
  ms: number,
  reason: CycleAbortReason,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CycleAborted(reason, ms)), ms);
  });
  // A late rejection of the abandoned work is not an unhandled one.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
