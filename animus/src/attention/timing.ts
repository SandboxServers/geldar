/** The time the attention controller reads, both injected so every decision is deterministic. */

/** The wall clock in milliseconds. Only differences are used. */
export interface Clock {
  nowMs(): number;
}

/** Runs a callback once after a delay. Returns the function that cancels it. */
export interface Scheduler {
  after(delayMs: number, callback: () => void): () => void;
}

/** The real clock and scheduler. */
export const systemTiming: { clock: Clock; scheduler: Scheduler } = {
  clock: { nowMs: () => Date.now() },
  scheduler: {
    after(delayMs, callback) {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    },
  },
};
