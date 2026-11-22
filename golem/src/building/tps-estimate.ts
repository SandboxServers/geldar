// Body-side TPS estimate (BLD-38c). It is measured from this Body's own tick loop: the wall-clock
// time between consecutive world ticks over a short window. A tick every 50 ms is 20 TPS. It is an
// estimate of the server's tick rate as this Body sees it, not Bukkit's TPS and not the `server_tps`
// event, which is not read here.

/** The most TPS the server runs at; the estimate never reports more. */
export const MAX_TPS = 20;
/** Ticks kept in the window; the estimate uses the intervals between them. */
export const TPS_WINDOW_TICKS = 40;
/** Fewer intervals than this and there is no estimate yet (`undefined`). */
export const TPS_MIN_INTERVALS = 5;

/** Wall-clock source in ms; injected so tests control time. */
export type WallClock = () => number;

/** Estimates TPS from the wall-clock times of recent world ticks. */
export class TpsEstimator {
  private readonly now: WallClock;
  private readonly stamps: number[] = [];

  constructor(now: WallClock = () => Date.now()) {
    this.now = now;
  }

  /** Records one world tick at the current clock time. */
  onTick(): void {
    this.stamps.push(this.now());
    if (this.stamps.length > TPS_WINDOW_TICKS + 1) this.stamps.shift();
  }

  /**
   * The estimated TPS over the window, capped at 20. Undefined until `TPS_MIN_INTERVALS` intervals
   * are known. A window that spans no time (clock did not move) reads as the cap.
   */
  tps(): number | undefined {
    const intervals = this.stamps.length - 1;
    if (intervals < TPS_MIN_INTERVALS) return undefined;
    const elapsed = (this.stamps[this.stamps.length - 1] ?? 0) - (this.stamps[0] ?? 0);
    if (elapsed <= 0) return MAX_TPS;
    return Math.min(MAX_TPS, (intervals * 1000) / elapsed);
  }
}
