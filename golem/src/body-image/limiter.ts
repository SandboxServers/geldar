// The image budget of one Body: at most one image per 5 s and 30 per rolling hour (decision 0156).
// A refused call takes nothing from the budget.

export const MIN_GAP_MS = 5_000;
export const HOUR_MS = 3_600_000;
export const HOUR_LIMIT = 30;

export type LimitVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export class ImageLimiter {
  /** Times of the taken images inside the last hour, oldest first. Bounded by HOUR_LIMIT. */
  private readonly taken: number[] = [];
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Takes one image from the budget, or says how long to wait before the next one. */
  take(): LimitVerdict {
    const t = this.now();
    while (this.taken.length > 0 && t - (this.taken[0] ?? t) >= HOUR_MS) this.taken.shift();
    const last = this.taken.at(-1);
    if (last !== undefined && t - last < MIN_GAP_MS) {
      return { ok: false, retryAfterMs: MIN_GAP_MS - (t - last) };
    }
    if (this.taken.length >= HOUR_LIMIT) {
      return { ok: false, retryAfterMs: (this.taken[0] ?? t) + HOUR_MS - t };
    }
    this.taken.push(t);
    return { ok: true };
  }
}
