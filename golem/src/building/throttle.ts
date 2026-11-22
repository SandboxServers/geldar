// Tick-budget throttle for the plan lane (BLD-15).
//
// This is a health throttle, not a policy cap. It sets no limit on cells, volume or
// edits per day. It widens the minimum gap between block operations as the server's
// reported TPS falls, and pauses the lane when the server is badly behind. The lane
// resumes when TPS recovers. The TPS source is the existing `server_tps` world event.

/** One server tick in milliseconds. */
export const TICK_MS = 50;

/** Minimum gap in ticks between block operations at healthy TPS. */
export const BASE_GAP_TICKS = 4;

/** The gap used from 12 up to 18 TPS: the base gap doubled. */
export const SLOW_GAP_TICKS = 8;

/** Below this TPS the lane pauses and reports `waiting_tps`. */
export const PAUSE_BELOW_TPS = 12;

/** Below this TPS the gap is doubled. At or above it the base gap applies. */
export const SLOW_BELOW_TPS = 18;

/** How often a paused lane re-reads TPS, in ticks. */
export const PAUSE_POLL_TICKS = 20;

/** Sleeps for `ms`, rejecting with the signal's reason if it aborts first. */
export type ThrottleSleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface ThrottleOptions {
  signal: AbortSignal;
  /** The body's time scale. Waits are multiplied by it, as in the other actions. */
  timeScale?: number;
  /** The latest `server_tps` value, or undefined when none has been reported yet. */
  readTps: () => number | undefined;
  /** Defaults to a real timer. Tests pass a fake clock. */
  sleep?: ThrottleSleep;
  /** Called once when the lane starts waiting for TPS to recover. */
  onPause?: () => void;
}

export interface ThrottleResult {
  /** The gap that was waited before this block operation, in ticks. */
  gapTicks: number;
  /** True when the lane was paused for TPS before this operation. */
  paused: boolean;
}

/**
 * The gap in ticks for a TPS reading: the base gap at 18 TPS and above, doubled from
 * 12 up to 18, and null (pause) below 12. An unknown reading runs at full speed.
 */
export function gapTicksFor(tps: number | undefined): number | null {
  if (tps === undefined) return BASE_GAP_TICKS;
  if (tps < PAUSE_BELOW_TPS) return null;
  if (tps < SLOW_BELOW_TPS) return SLOW_GAP_TICKS;
  return BASE_GAP_TICKS;
}

const defaultSleep: ThrottleSleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Waits before the next block operation. While TPS is below 12 it pauses, polling every
 * PAUSE_POLL_TICKS, and reports the pause once. Then it waits the TPS-dependent gap.
 * Throws the signal's reason if aborted, and propagates errors from `readTps`.
 */
export async function throttleWait(options: ThrottleOptions): Promise<ThrottleResult> {
  const { signal, readTps } = options;
  const scale = options.timeScale ?? 1;
  const sleep = options.sleep ?? defaultSleep;
  let paused = false;
  for (;;) {
    signal.throwIfAborted();
    const gapTicks = gapTicksFor(readTps());
    if (gapTicks !== null) {
      await sleep(gapTicks * TICK_MS * scale, signal);
      return { gapTicks, paused };
    }
    if (!paused) {
      paused = true;
      options.onPause?.();
    }
    await sleep(PAUSE_POLL_TICKS * TICK_MS * scale, signal);
  }
}
