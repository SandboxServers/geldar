package dev.geldar.ledger.core;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * Lock-free rate limiter (generic cell rate algorithm in one CAS word). Burst equals the rate: a fresh
 * or idle bucket admits exactly {@code ratePerSecond} takes at once, then one per {@code 1/rate} seconds.
 * {@link #tryTake()} is O(1), never blocks and never allocates.
 */
public final class TokenBucket {
  private static final long NANOS = 1_000_000_000L;

  private final LongSupplier nanoClock;
  private final long interval;
  private final long window;
  private final boolean closed;
  /** Theoretical arrival time of the next cell, in nanoClock units. */
  private final AtomicLong tat;

  public TokenBucket(int ratePerSecond, LongSupplier nanoClock) {
    if (ratePerSecond < 0) {
      throw new IllegalArgumentException("rate must be >= 0");
    }
    this.nanoClock = nanoClock;
    this.closed = ratePerSecond == 0;
    this.interval = closed ? NANOS : Math.max(1L, NANOS / ratePerSecond);
    this.window = interval * Math.max(1, ratePerSecond);
    this.tat = new AtomicLong(nanoClock.getAsLong());
  }

  /** True if the caller may proceed; false means drop. */
  public boolean tryTake() {
    if (closed) {
      return false;
    }
    long now = nanoClock.getAsLong();
    while (true) {
      long cur = tat.get();
      long base = Math.max(cur, now);
      long next = base + interval;
      if (next - now > window) {
        return false;
      }
      if (tat.compareAndSet(cur, next)) {
        return true;
      }
    }
  }
}