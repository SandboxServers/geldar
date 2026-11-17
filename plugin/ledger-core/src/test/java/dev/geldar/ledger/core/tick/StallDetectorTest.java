package dev.geldar.ledger.core.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StallDetectorTest {
  private static final long MS = 1_000_000L;
  private long now;

  private StallDetector detector(long thresholdMs, long start) {
    now = start;
    return new StallDetector(thresholdMs, () -> now);
  }

  @Test
  void measuredPauseIsAvailableOnceAfterTheStallEnds() {
    StallDetector d = detector(1000, 0);
    assertEquals(-1, d.takeRecoveredNanos());
    now = 1500 * MS;
    assertTrue(d.check());
    assertEquals(-1, d.takeRecoveredNanos(), "still stalled: no pause yet");
    now = 3200 * MS;
    d.heartbeat();
    assertFalse(d.check());
    assertEquals(3200 * MS, d.takeRecoveredNanos());
    assertEquals(-1, d.takeRecoveredNanos(), "taken once");
    now = 3300 * MS;
    d.heartbeat();
    assertFalse(d.check());
    assertEquals(-1, d.takeRecoveredNanos(), "a normal heartbeat is not a stall");
  }

  @Test
  void reportsExactlyOncePerStallAndAgainAfterHeartbeat() {
    StallDetector d = detector(1000, 0);
    now = 1000 * MS;
    assertFalse(d.check(), "exactly at threshold is not a stall");
    now = 1001 * MS;
    assertTrue(d.check());
    now = 5000 * MS;
    assertFalse(d.check());
    assertFalse(d.check());
    d.heartbeat();
    assertFalse(d.check());
    now += 1500 * MS;
    assertTrue(d.check());
    assertFalse(d.check());
  }

  @Test
  void noReportWhileHeartbeatsContinue() {
    StallDetector d = detector(1000, 0);
    for (int i = 0; i < 100; i++) {
      now += 50 * MS;
      d.heartbeat();
      assertFalse(d.check());
    }
  }

  @Test
  void heartbeatBetweenStallsWithoutCheckStillReArms() {
    StallDetector d = detector(100, 0);
    now = 200 * MS;
    assertTrue(d.check());
    now = 210 * MS;
    d.heartbeat();
    now = 400 * MS;
    assertTrue(d.check());
  }

  @Test
  void survivesNanoTimeWrapAround() {
    StallDetector d = detector(100, Long.MAX_VALUE - 10 * MS);
    d.heartbeat();
    now = Long.MAX_VALUE - 10 * MS + 50 * MS; // wrapped negative, 50 ms later
    assertFalse(d.check());
    now += 100 * MS;
    assertTrue(d.check());
  }
}
