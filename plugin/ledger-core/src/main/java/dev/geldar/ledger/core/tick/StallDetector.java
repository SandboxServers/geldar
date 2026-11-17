package dev.geldar.ledger.core.tick;

import java.util.function.LongSupplier;

/** Detects a main thread that stopped ticking. heartbeat() from the main thread, check() from an async thread. */
public final class StallDetector {
  private final long thresholdNanos;
  private final LongSupplier nanoClock;
  private volatile long lastHeartbeat;
  // Only touched by check() (single async thread) and reset via the heartbeat stamp.
  private long reportedFor = Long.MIN_VALUE;
  private boolean reported;
  private long recoveredNanos = -1;

  public StallDetector(long thresholdMs, LongSupplier nanoClock) {
    this.thresholdNanos = thresholdMs * 1_000_000L;
    this.nanoClock = nanoClock;
    this.lastHeartbeat = nanoClock.getAsLong();
  }

  public void heartbeat() {
    lastHeartbeat = nanoClock.getAsLong();
  }

  /**
   * The measured length in ns of a reported stall that has ended, once; -1 while none is pending. Call after
   * {@link #check()}, from the same thread.
   */
  public long takeRecoveredNanos() {
    long n = recoveredNanos;
    recoveredNanos = -1;
    return n;
  }

  /** True once per stall: when the last heartbeat is older than the threshold and not yet reported. */
  public boolean check() {
    long beat = lastHeartbeat;
    if (reported && beat != reportedFor) {
      reported = false; // a heartbeat arrived since the report
      recoveredNanos = beat - reportedFor; // the measured pause: last old beat to first new beat
    }
    if (reported) {
      return false;
    }
    // Subtraction keeps the comparison correct across nanoTime wrap-around.
    if (nanoClock.getAsLong() - beat > thresholdNanos) {
      reported = true;
      reportedFor = beat;
      return true;
    }
    return false;
  }
}
