/** Time for the world simulation. All sim logic takes a `Clock`, so tests drive it with `FakeClock`. */
export interface Clock {
  nowMs(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** The wall clock: `Date.now` and `setTimeout`. */
export class RealClock implements Clock {
  nowMs(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

interface PendingSleep {
  dueMs: number;
  order: number;
  resolve: () => void;
  cleanup: () => void;
}

/** A manual clock: time moves only through `advance`. */
export class FakeClock implements Clock {
  private now: number;
  private counter = 0;
  private pending: PendingSleep[] = [];

  constructor(startMs = 0) {
    this.now = startMs;
  }

  nowMs(): number {
    return this.now;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<void>((resolve, reject) => {
      const entry: PendingSleep = {
        dueMs: this.now + ms,
        order: this.counter++,
        resolve,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      };
      const onAbort = (): void => {
        this.pending = this.pending.filter((p) => p !== entry);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.push(entry);
    });
  }

  /** Moves time forward, firing due sleeps in time order. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      let next: PendingSleep | undefined;
      for (const p of this.pending) {
        if (p.dueMs > target) continue;
        if (!next || p.dueMs < next.dueMs || (p.dueMs === next.dueMs && p.order < next.order))
          next = p;
      }
      if (!next) break;
      this.pending = this.pending.filter((p) => p !== next);
      this.now = Math.max(this.now, next.dueMs);
      next.cleanup();
      next.resolve();
      // Let the awakened code run before the next timer fires.
      await new Promise<void>((r) => setImmediate(r));
    }
    this.now = target;
  }
}

/** Game ticks in one day. */
export const TICKS_PER_DAY = 24000;

/** Ticks that pass per real second. */
export function ticksPerSecond(dayLengthSeconds: number): number {
  return TICKS_PER_DAY / dayLengthSeconds;
}

/** The tick reached after `elapsedMs` of sim time. */
export function tickAt(elapsedMs: number, dayLengthSeconds: number): number {
  return Math.floor((elapsedMs * TICKS_PER_DAY) / (dayLengthSeconds * 1000));
}

/** The first millisecond at which `tickAt` is at least `tick`. */
export function msAt(tick: number, dayLengthSeconds: number): number {
  return Math.ceil((tick * dayLengthSeconds * 1000) / TICKS_PER_DAY);
}
