/** The most clients the per-client table holds. At the cap the least recently seen client is dropped. */
export const MAX_PUBLIC_CLIENTS = 4096;

interface Bucket {
  tokens: number;
  atMs: number;
}

/**
 * The per-client token bucket on every public request (decision 0090): `burst` tokens, refilled
 * at `perMinute` a minute, one token per request. The clock is passed in, so a test can drive it.
 * The table is bounded: a new client past the cap evicts the least recently seen one.
 */
export class PublicRateLimit {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;
  private readonly burst: number;
  private readonly maxClients: number;

  constructor(perMinute: number, burst: number, maxClients = MAX_PUBLIC_CLIENTS) {
    this.perMs = perMinute / 60_000;
    this.burst = burst;
    this.maxClients = maxClients;
  }

  /** Clients the table holds now. Never more than the cap. */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Takes one token for the client. Returns undefined when the request is allowed; otherwise the
   * whole seconds until the client has a token again, at least 1.
   */
  take(client: string, nowMs: number): number | undefined {
    const bucket = this.touch(client, nowMs);
    const elapsed = Math.max(0, nowMs - bucket.atMs);
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.perMs);
    bucket.atMs = nowMs;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return undefined;
    }
    const waitMs = Math.ceil((1 - bucket.tokens) / this.perMs);
    return Math.max(1, Math.ceil(waitMs / 1000));
  }

  /** The client's bucket, moved to the most recent end of the table; a new client starts full. */
  private touch(client: string, nowMs: number): Bucket {
    const known = this.buckets.get(client);
    if (known !== undefined) {
      this.buckets.delete(client);
      this.buckets.set(client, known);
      return known;
    }
    if (this.buckets.size >= this.maxClients) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    const fresh: Bucket = { tokens: this.burst, atMs: nowMs };
    this.buckets.set(client, fresh);
    return fresh;
  }
}
