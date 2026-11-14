/** One day in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** A player token lives 90 days from issue (decision 0170, point 1). */
export const TOKEN_LIFETIME_MS = 90 * DAY_MS;

/** The renewal flag is true from 14 days before expiry, inclusive (decision 0170). */
export const RENEWAL_WARNING_MS = 14 * DAY_MS;

/** A rotated-out token keeps working for 10 minutes, the grace the operator CLI already has. */
export const ROTATE_GRACE_MS = 10 * 60 * 1000;

/** The expiry instant of a token issued at `issuedAt`. */
export function tokenExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS);
}

/**
 * Whether a token may be used at `now`. It is refused at its expiry instant and accepted one
 * millisecond earlier; a revoked token is never usable.
 */
export function tokenUsable(expiresAt: Date, revokedAt: Date | null, now: Date): boolean {
  if (revokedAt !== null) return false;
  return now.getTime() < expiresAt.getTime();
}

/** Whether the renewal flag is set: true from exactly 14 days before expiry until expiry. */
export function renewalDue(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() <= RENEWAL_WARNING_MS;
}

/** One second past the 10 minutes: the old token is accepted at exactly 10:00 and refused at 10:01. */
export const GRACE_END_SLACK_MS = 1000;

/**
 * The expiry instant of the old token after a renewal at `rotatedAt`. The old token is accepted
 * up to 10 minutes after the rotation and refused from 10 minutes and one second on.
 */
export function graceEndsAt(rotatedAt: Date): Date {
  return new Date(rotatedAt.getTime() + ROTATE_GRACE_MS + GRACE_END_SLACK_MS);
}
