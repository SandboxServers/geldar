package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 30, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class TokenBucketTest {
  @Test
  void givesExactlyRateInOneSecondOfFakeTime() {
    AtomicLong now = new AtomicLong(5_000_000_000L);
    TokenBucket b = new TokenBucket(20, now::get);
    int taken = 0;
    // Hammer the bucket across one second of fake time in 1 ms steps, 3 attempts per step.
    for (int ms = 0; ms < 1000; ms++) {
      for (int k = 0; k < 3; k++) {
        if (b.tryTake()) {
          taken++;
        }
      }
      now.addAndGet(1_000_000L);
    }
    // The k-th take needs k*50ms <= 1000ms + now; at now = 999 ms that is k <= 39.
    assertEquals(39, taken);
  }

  @Test
  void burstIsExactlyRateThenRefillsAfterOneSecond() {
    AtomicLong now = new AtomicLong(0);
    TokenBucket b = new TokenBucket(20, now::get);
    int first = 0;
    while (b.tryTake()) {
      first++;
    }
    assertEquals(20, first);
    assertFalse(b.tryTake());
    now.addAndGet(1_000_000_000L);
    int second = 0;
    while (b.tryTake()) {
      second++;
    }
    assertEquals(20, second);
  }

  @Test
  void idleTimeDoesNotBuildBurstBeyondRate() {
    AtomicLong now = new AtomicLong(0);
    TokenBucket b = new TokenBucket(5, now::get);
    now.addAndGet(60_000_000_000L);
    int n = 0;
    while (b.tryTake()) {
      n++;
    }
    assertEquals(5, n);
  }

  @Test
  void staysExactAcrossTheNanoTimeWrap() {
    AtomicLong now = new AtomicLong(Long.MAX_VALUE - 500_000_000L);
    TokenBucket b = new TokenBucket(20, now::get);
    int first = 0;
    while (b.tryTake()) { // the theoretical arrival time passes Long.MAX_VALUE here
      first++;
    }
    assertEquals(20, first);
    assertFalse(b.tryTake());
    now.addAndGet(500_000_000L); // now itself wraps negative and half the window has refilled
    int half = 0;
    while (b.tryTake()) {
      half++;
    }
    assertEquals(10, half);    now.addAndGet(1_000_000_000L);
    int second = 0;
    while (b.tryTake()) {
      second++;
    }
    assertEquals(20, second);
  }

  @Test
  void zeroRateAlwaysDropsAndNegativeIsRejected() {
    TokenBucket b = new TokenBucket(0, () -> 0L);
    assertFalse(b.tryTake());
    assertThrows(IllegalArgumentException.class, () -> new TokenBucket(-1, () -> 0L));
  }
}