package dev.geldar.ledger.core.tick;

import java.util.function.LongSupplier;

/** Detects a main thread that stopped ticking. heartbeat() from the main thread, check() from an async thread. */
public final class StallDetector {
  private final long thresholdNanos;
  private final LongSupplier nanoClock;
  private volatile long lastHeartbeat;
  // The first heartbeat after a reported stall: written by heartbeat() (main thread), read by check().
  private volatile boolean awaitingFirstBeat;
  private volatile long firstBeatAfterStall;
  // Only touched by check() (single async thread) and reset via the heartbeat stamp.
  private long reportedFor = Long.MIN_VALUE;
  private boolean reported;
  private long recoveredNanos = -1;
  private long detectedNanos;

  public StallDetector(long thresholdMs, LongSupplier nanoClock) {
    this.thresholdNanos = thresholdMs * 1_000_000L;
    this.nanoClock = nanoClock;
    this.lastHeartbeat = nanoClock.getAsLong();
  }

  public void heartbeat() {
    long now = nanoClock.getAsLong();
    if (awaitingFirstBeat) {
      firstBeatAfterStall = now; // before the flag drops, so a reader that sees the flag down sees this
      awaitingFirstBeat = false;
    }
    lastHeartbeat = now;
  }

  /**
   * The measured length in ns of a reported stall that has ended (last old beat to the FIRST new beat), once; -1 while
   * none is pending. Call after {@link #check()}, from the same thread.
   */
  public long takeRecoveredNanos() {
    long n = recoveredNanos;
    recoveredNanos = -1;
    return n;
  }

  /** The pause in ns at the moment the last stall was detected (at least the threshold). */
  public long detectedNanos() {
    return detectedNanos;
  }

  /** True once per stall: when the last heartbeat is older than the threshold and not yet reported. */
  public boolean check() {
    long beat = lastHeartbeat;
    if (reported && beat != reportedFor) {
      reported = false; // a heartbeat arrived since the report
      long first = firstBeatAfterStall;
      if (awaitingFirstBeat || first == 0) {
        first = beat; // the stamp raced with the report: fall back to the latest beat
      }
      recoveredNanos = first - reportedFor; // the measured pause: last old beat to first new beat
      firstBeatAfterStall = 0;
      awaitingFirstBeat = false;
    }
    if (reported) {
      return false;
    }
    // Subtraction keeps the comparison correct across nanoTime wrap-around.
    long elapsed = nanoClock.getAsLong() - beat;
    if (elapsed > thresholdNanos) {
      reported = true;
      reportedFor = beat;
      detectedNanos = elapsed;
      firstBeatAfterStall = 0;
      awaitingFirstBeat = true;
      return true;
    }
    return false;
  }
}
