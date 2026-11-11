/**
 * Per-key token buckets for the Kino relay: a viewer (or an anonymous client address) may send a few
 * subscribe frames at once and then one every `refillMs`. The map is pruned so a flood of keys cannot grow it.
 */
export interface BucketOptions {
  burst: number;
  refillMs: number;
  now?: () => number;
  maxKeys?: number;
}

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly o: Required<BucketOptions>;

  constructor(o: BucketOptions) {
    this.o = { now: Date.now, maxKeys: 4096, ...o };
  }

  /** True when the key may proceed (one token is spent). */
  take(key: string): boolean {
    const now = this.o.now();
    const b = this.buckets.get(key) ?? { tokens: this.o.burst, at: now };
    b.tokens = Math.min(this.o.burst, b.tokens + (now - b.at) / this.o.refillMs);
    b.at = now;
    this.buckets.delete(key);
    this.buckets.set(key, b);
    if (this.buckets.size > this.o.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
