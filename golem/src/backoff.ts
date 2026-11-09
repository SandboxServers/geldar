/** Exponential backoff with jitter, in milliseconds. */
export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
  /** Relative spread: 0.2 means the delay varies between 80% and 120% of its nominal value. */
  jitter: number;
}

/** The reconnect policy Golem uses: 1 s doubling to a 30 s cap, with 20% jitter. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1000, maxMs: 30000, jitter: 0.2 };

/**
 * Delay before reconnect attempt `attempt` (1 is the first retry). The nominal delay doubles from
 * `baseMs` and is capped at `maxMs`; jitter is applied after the cap, so the largest delay is
 * `maxMs * (1 + jitter)`.
 */
export function nextDelayMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  rng: () => number = Math.random,
): number {
  const nominal = Math.min(policy.maxMs, policy.baseMs * 2 ** (Math.max(1, attempt) - 1));
  const jittered = nominal * (1 + policy.jitter * (2 * rng() - 1));
  return Math.min(Math.round(jittered), Math.round(policy.maxMs * (1 + policy.jitter)));
}
