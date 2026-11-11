/**
 * The fixed public refusal bodies (decision 0090). Each names no switch, no config key and no
 * detail about the token, so a refusal cannot tell a client what the server checked.
 */

/** The kill switch: HTTP 503 on every public request while `public.kill_switch` is true. */
export const KILL_SWITCH_BODY = {
  error: { code: 'unavailable', message: 'Service unavailable' },
} as const;

/** HTTP 401 for a missing, malformed or unknown token alike (with `WWW-Authenticate: Bearer`). */
export const UNAUTHENTICATED_BODY = {
  error: { code: 'unauthenticated', message: 'Unauthorized' },
} as const;

/** The per-client rate limit: HTTP 429 with this body and the same seconds in `Retry-After`. */
export function rateLimitedBody(retryAfterSec: number): Record<string, unknown> {
  return {
    error: { code: 'rate_limited', message: 'Too many requests' },
    retryAfter: retryAfterSec,
  };
}
