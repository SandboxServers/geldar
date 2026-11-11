/** How long one address's count of failures runs, from its first failure (ms). */
export const NEGATIVE_CACHE_MS = 30_000;
/** Most addresses the table holds at once. */
export const NEGATIVE_CACHE_MAX = 1024;
/** Failures within one window after which an address counts as flagged. */
export const NEGATIVE_CACHE_FLAG_AFTER = 16;

interface Entry {
  startMs: number;
  failures: number;
}

/**
 * Recent failed bearer attempts, counted per client address key. An address that failed
 * NEGATIVE_CACHE_FLAG_AFTER times within NEGATIVE_CACHE_MS is flagged; the front door then skips
 * the store query that explains a miss (that query is for the log only), so a sustained flood of bad
 * bearers from one address costs the store one lookup each and no extra query. The answer is never
 * changed: a failed or missing token gets the same 401 body on every try, and a valid token from a
 * flagged address is still resolved and accepted.
 *
 * At the cap the table evicts the entry that was recorded longest ago (insertion order; a new failure
 * moves its address to the newest place). The table never grows past NEGATIVE_CACHE_MAX, and an
 * address pushed out loses its count and its flag.
 */
export class NegativeCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly flagAfter: number;

  constructor(
    ttlMs = NEGATIVE_CACHE_MS,
    max = NEGATIVE_CACHE_MAX,
    flagAfter = NEGATIVE_CACHE_FLAG_AFTER,
  ) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.flagAfter = flagAfter;
  }

  /** True when the key has failed `flagAfter` times in its current window. An expired entry is dropped. */
  recent(key: string, nowMs: number): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) return false;
    if (nowMs - entry.startMs >= this.ttlMs) {
      this.entries.delete(key);
      return false;
    }
    return entry.failures >= this.flagAfter;
  }

  /** Notes a failed attempt at `nowMs`; a failure after the window has run out starts a new window. */
  record(key: string, nowMs: number): void {
    const old = this.entries.get(key);
    const live = old !== undefined && nowMs - old.startMs < this.ttlMs;
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, {
      startMs: live ? old.startMs : nowMs,
      failures: live ? old.failures + 1 : 1,
    });
  }

  get size(): number {
    return this.entries.size;
  }
}
