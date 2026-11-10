/**
 * The shard's tick rate, read from the world_tick and at of its server_tps events. The Paper plugin emits one
 * server_tps every 20 s, stamped with the world's full time (world_tick) and the producer's wall clock (at). Both
 * columns are granted to geldar_glass; the payload (which holds the TPS figure itself) is not, so this reader
 * uses the tick counter instead. Ticks per second over a stretch of events is the TPS the server actually ran.
 */

/** How far back the sampler reads server_tps events; the TPS abort rule's window is 5 minutes. */
export const TICK_WINDOW_MS = 5 * 60_000;

/** Two events further apart than this are not one stretch: a restart or a stall breaks the rate. */
const MAX_GAP_MS = 60_000;

/** The shortest stretch that gives a rate. Shorter than this, a single tick of jitter moves the figure too far. */
const MIN_SPAN_MS = 60_000;

export interface TickPoint {
  atMs: number;
  tick: number;
}

/**
 * Ticks per second over the last contiguous stretch of points, which must end within MAX_GAP_MS of nowMs.
 * Null when the newest point is stale, the stretch is shorter than MIN_SPAN_MS, or the counter went backwards.
 * Points may arrive in any order.
 */
export function tickRate(points: readonly TickPoint[], nowMs: number): number | null {
  const sorted = [...points].sort((a, b) => a.atMs - b.atMs);
  const last = sorted.at(-1);
  if (last === undefined || nowMs - last.atMs > MAX_GAP_MS) return null;
  let first = last;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const earlier = sorted[i] as TickPoint;
    const later = sorted[i + 1] as TickPoint;
    if (later.atMs - earlier.atMs > MAX_GAP_MS) break;
    first = earlier;
  }
  const spanMs = last.atMs - first.atMs;
  const ticks = last.tick - first.tick;
  if (spanMs < MIN_SPAN_MS || ticks < 0) return null;
  return ticks / (spanMs / 1000);
}
