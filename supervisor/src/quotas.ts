// Decision 0170, point 3 (body quotas) and point 4 (log tail). Admins are exempt from the two
// start counters only (point 5); the one-running-body rule and the ownership check always apply.

export const RUNNING_PER_AGENT = 1;
export const STARTS_PER_AGENT_PER_HOUR = 3;
export const STARTS_PER_OWNER_PER_DAY = 10;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const LOG_TAIL_LIMIT = 200;
export const LOG_TAIL_WINDOW_MS = 7 * DAY_MS;

// The counters look back from `now`: a start at exactly `now - HOUR_MS` no longer counts.
export function hourAgo(now: Date): Date {
  return new Date(now.getTime() - HOUR_MS);
}

export function dayAgo(now: Date): Date {
  return new Date(now.getTime() - DAY_MS);
}
