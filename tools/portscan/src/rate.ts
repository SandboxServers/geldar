/** Waits for `ms` milliseconds. Injected so tests run on a fake clock. */
export type Sleep = (ms: number) => Promise<void>;

export interface RateGate {
  /** Resolves when the caller may start its next connect. Calls are spaced at least 1000 / perSecond ms apart. */
  wait(): Promise<void>;
}

/**
 * A fixed-rate gate. Each call reserves the next start slot synchronously, before it awaits, so concurrent
 * callers queue in order and never start two connects in the same slot.
 */
export function createRateGate(perSecond: number, now: () => number, sleep: Sleep): RateGate {
  if (!Number.isFinite(perSecond) || perSecond <= 0) {
    throw new RangeError(`perSecond must be a positive number, got ${perSecond}`);
  }
  const interval = 1000 / perSecond;
  let slot = Number.NEGATIVE_INFINITY;
  return {
    async wait(): Promise<void> {
      const current = now();
      const start = Math.max(current, slot);
      slot = start + interval;
      if (start > current) await sleep(start - current);
    },
  };
}
