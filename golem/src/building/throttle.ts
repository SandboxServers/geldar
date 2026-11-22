// Tick-budget throttle for the plan lane (BLD-15, tick-based since BLD-38f2).
//
// This is a health throttle, not a policy cap. It sets no limit on cells, volume or
// edits per day. It widens the minimum gap between block operations as the server's
// reported TPS falls, and pauses the lane when the server is badly behind. The lane
// resumes when TPS recovers. The TPS source is the existing `server_tps` world event.
//
// Every wait is a count of world ticks, read from the Body's tick hook. Nothing here
// sleeps: a wait is a verdict for one tick, and the lane asks again on the next tick.

/** Minimum gap in ticks between block operations at healthy TPS. */
export const BASE_GAP_TICKS = 4;

/** The gap used from 12 up to 18 TPS: the base gap doubled. */
export const SLOW_GAP_TICKS = 8;

/** Below this TPS the lane pauses and reports `waiting_tps`. */
export const PAUSE_BELOW_TPS = 12;

/** Below this TPS the gap is doubled. At or above it the base gap applies. */
export const SLOW_BELOW_TPS = 18;

/**
 * What the throttle says before a cell: `go` (the cell may run now), `gap` (the gap since the
 * last cell has not passed: wait for a later tick) or `tps` (TPS is below 12: the lane waits
 * for TPS to recover, phase waiting_tps).
 */
export type ThrottleVerdict = 'go' | 'gap' | 'tps';

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

/**
 * The tick-based throttle. `before(now)` is asked before each cell at world tick `now`. It reads
 * TPS (a throw propagates to the caller). Below 12 TPS it returns `tps` and no cell runs. Before
 * the gap since the last cell has passed it returns `gap`. Otherwise it returns `go` and starts the
 * next gap from `now`, so a cell is followed by `gapTicksFor(tps)` ticks of waiting.
 */
export class TickThrottle {
  private nextTick = 0;
  private readonly readTps: () => number | undefined;

  constructor(readTps: () => number | undefined) {
    this.readTps = readTps;
  }

  before(now: number): ThrottleVerdict {
    const gap = gapTicksFor(this.readTps());
    if (gap === null) return 'tps';
    if (now < this.nextTick) return 'gap';
    this.nextTick = now + gap;
    return 'go';
  }
}
