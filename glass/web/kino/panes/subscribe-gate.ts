// The page's subscribe gate (decision 0166): every subscribe a monitor sends waits here until the
// page's copy of the relay's rate limit allows it, so channel surfing, mode changes and a restored
// wall stay under the limit instead of being refused. Pure apart from the injected clock and timer.
//
// The relay (glass/src/kino/relay.ts) keeps two token buckets per viewer: one for a change of agent,
// one for a change of mode on the same agent, each a burst of 8 then one per 2 s. This gate mirrors
// both for this page only. The relay's buckets are per viewer session, shared with the viewer's other
// tabs and reloads, so a subscribe can still be refused; the monitors handle that (session.ts).

/** The relay's subscribe limit (SUBSCRIBE_BURST and SUBSCRIBE_REFILL_MS); a test checks they match. */
export const GATE_BURST = 8;
export const GATE_REFILL_MS = 2000;

/** Which relay bucket a subscribe spends: a change of agent, or a change of mode on the same agent. */
export type Bucket = 'target' | 'mode';

export interface GateClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Entry {
  key: string;
  bucket: Bucket;
  send: () => void;
  notBefore: number;
}

export class SubscribeGate {
  private readonly burst: number;
  private readonly refillMs: number;
  private readonly clock: GateClock;
  private readonly tokens: Record<Bucket, { level: number; at: number }>;
  private queue: Entry[] = [];
  private timer: unknown = null;

  constructor(clock: GateClock, burst = GATE_BURST, refillMs = GATE_REFILL_MS) {
    this.clock = clock;
    this.burst = burst;
    this.refillMs = refillMs;
    const now = clock.now();
    this.tokens = { target: { level: burst, at: now }, mode: { level: burst, at: now } };
  }

  /**
   * Asks to send for `key` (one monitor), no sooner than `delayMs` from now. A request replaces the
   * key's waiting one (latest wins), so a burst of steps sends once. A key that has a change of agent
   * waiting keeps the `target` bucket.
   */
  request(key: string, bucket: Bucket, send: () => void, delayMs = 0): void {
    const notBefore = this.clock.now() + delayMs;
    const old = this.queue.find((e) => e.key === key);
    if (old) {
      old.send = send;
      old.notBefore = notBefore;
      if (bucket === 'target') old.bucket = 'target';
    } else this.queue.push({ key, bucket, send, notBefore });
    this.drain();
  }

  /** Drops the key's waiting request (a monitor closed). */
  cancel(key: string): void {
    this.queue = this.queue.filter((e) => e.key !== key);
    this.drain();
  }

  /** True while the key has a request waiting. */
  waiting(key: string): boolean {
    return this.queue.some((e) => e.key === key);
  }

  private level(b: Bucket, now: number): number {
    const t = this.tokens[b];
    t.level = Math.min(this.burst, t.level + (now - t.at) / this.refillMs);
    t.at = now;
    return t.level;
  }

  private drain(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    const now = this.clock.now();
    const ready: Entry[] = [];
    // In order of asking; an entry that must wait does not hold up one in the other bucket.
    for (const e of this.queue) {
      if (e.notBefore > now || this.level(e.bucket, now) < 1) continue;
      this.tokens[e.bucket].level -= 1;
      ready.push(e);
    }
    this.queue = this.queue.filter((e) => !ready.includes(e));
    let wake = Number.POSITIVE_INFINITY;
    for (const e of this.queue) {
      const lack = 1 - this.level(e.bucket, now);
      const at = Math.max(e.notBefore, lack > 0 ? now + Math.ceil(lack * this.refillMs) : now);
      wake = Math.min(wake, at);
    }
    if (wake !== Number.POSITIVE_INFINITY)
      this.timer = this.clock.setTimer(() => this.drain(), Math.max(0, wake - now));
    for (const e of ready) e.send();
  }
}
