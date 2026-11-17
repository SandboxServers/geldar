package dev.geldar.ledger.core.tick;

/** Pure tick-time arithmetic. Called from the main thread; allocates nothing and reads no clock. */
public final class TickStats {
  /** Histogram bucket bounds in milliseconds. */
  public static final double[] BOUNDS = {1, 2, 5, 10, 20, 30, 40, 50, 75, 100, 250, 1000};

  /** A tick longer than this (strictly) is an overrun. */
  public static final double OVERRUN_MS = 50.0;

  public static final double DEFAULT_SLOW_TICK_MS = 100.0;

  private final double slowTickMs;
  private long overruns;

  public TickStats() {
    this(DEFAULT_SLOW_TICK_MS);
  }

  public TickStats(double slowTickMs) {
    this.slowTickMs = slowTickMs;
  }

  /** Records one tick; returns true when the tick is slow (strictly over slow_tick_ms). */
  public boolean onTick(double durationMs) {
    if (durationMs > OVERRUN_MS) {
      overruns++;
    }
    return durationMs > slowTickMs;
  }

  public long overruns() {
    return overruns;
  }
}
