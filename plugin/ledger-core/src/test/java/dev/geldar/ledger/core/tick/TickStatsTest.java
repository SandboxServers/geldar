package dev.geldar.ledger.core.tick;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class TickStatsTest {
  @Test
  void fiftyIsNotAnOverrunFiftyPointOneIs() {
    TickStats s = new TickStats();
    s.onTick(50.0);
    assertEquals(0, s.overruns());
    s.onTick(50.1);
    assertEquals(1, s.overruns());
  }

  @Test
  void slowBoundaryIsStrictAndConfigurable() {
    TickStats d = new TickStats();
    assertFalse(d.onTick(100.0));
    assertTrue(d.onTick(100.1));
    TickStats c = new TickStats(200);
    assertFalse(c.onTick(150));
    assertFalse(c.onTick(200.0));
    assertTrue(c.onTick(200.5));
  }

  @Test
  void zeroAndNegativeDurationsCountNothing() {
    TickStats s = new TickStats();
    assertFalse(s.onTick(0));
    assertFalse(s.onTick(-5));
    assertEquals(0, s.overruns());
  }

  @Test
  void singleHugeTickIsOneOverrunAndSlow() {
    TickStats s = new TickStats();
    assertTrue(s.onTick(1.0e9));
    assertEquals(1, s.overruns());
  }

  @Test
  void boundsAreFrozen() {
    assertArrayEquals(
        new double[] {1, 2, 5, 10, 20, 30, 40, 50, 75, 100, 250, 1000}, TickStats.BOUNDS);
  }
}
