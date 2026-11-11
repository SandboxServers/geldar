/**
 * The public policy Glass applies to each request: the client guard (0072 item 3) and, in later steps,
 * the kill switch, the delay and the sovereign rule. The defaults admit a request with no guard.
 */
import type { RateLimiter } from './guard.ts';

export interface PublicPolicy {
  /** Peers whose forwarded client address is believed. Empty: the socket address is used. */
  trustedProxies: ReadonlySet<string>;
  /** The per-client token bucket, or null when rate limiting is off (tests only). */
  limiter: RateLimiter | null;
}

/** The policy a handler uses when the caller gives none. */
export const OPEN_POLICY: PublicPolicy = {
  trustedProxies: new Set(),
  limiter: null,
};
