/**
 * The public policy Glass applies to each request: the client guard (0072 item 3), the thought delay
 * (item 5), and, in later steps, the sovereign rule and the kill switch. The defaults admit a request
 * with no guard and show every thought at once.
 */
import type { RateLimiter } from './guard.ts';
import type { Visibility } from './query.ts';

export interface PublicPolicy {
  /** Peers whose forwarded client address is believed. Empty: the socket address is used. */
  trustedProxies: ReadonlySet<string>;
  /** The per-client token bucket, or null when rate limiting is off (tests only). */
  limiter: RateLimiter | null;
  /** Seconds a thought waits before Glass shows it (0072 item 5). Zero shows it at once. */
  delaySeconds: number;
  /** True only when the owner rules that a living sovereign agent's thoughts and receipts may show. */
  showLivingSovereign: boolean;
  /** The clock the delay reads, in epoch milliseconds. */
  now: () => number;
}

/** The policy a handler uses when the caller gives none. */
export const OPEN_POLICY: PublicPolicy = {
  trustedProxies: new Set(),
  limiter: null,
  delaySeconds: 0,
  showLivingSovereign: false,
  now: () => Date.now(),
};

/** What a reader may see at the policy's clock: thoughts at or before `now - delaySeconds`. */
export function visibilityAt(policy: PublicPolicy): Visibility {
  const showLivingSovereign = policy.showLivingSovereign;
  if (policy.delaySeconds <= 0) return { shownUntil: null, showLivingSovereign };
  const cut = policy.now() - policy.delaySeconds * 1000;
  return { shownUntil: new Date(cut).toISOString(), showLivingSovereign };
}
