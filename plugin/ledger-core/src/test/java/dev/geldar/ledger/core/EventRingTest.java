package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class EventRingTest {
  private static final EventRing.ErrorCounter NO_ERRORS = () -> {};

  private static final class Rec {
    final List<String> rows = new ArrayList<>();
  }

  private static Sink recording(Rec r) {
    return (q, id, t, a, b, c, s1, s2, s3) ->
        r.rows.add(q + ":" + id + ":" + a + ":" + b + ":" + c + ":" + s1 + ":" + s2 + ":" + s3);
  }

  @Test
  void rejectsNonPowerOfTwoCapacity() {
    assertThrows(
        IllegalArgumentException.class, () -> new EventRing("q", 100, new DropCounters()));
  }

  @Test
  void fullRingDropsAndCountsNeverBlocks() {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 64, drops);
    for (int i = 0; i < 64; i++) {
      assertTrue(ring.offer(1, i, 0, 0, "x", null, null));
    }
    long start = System.nanoTime();
    for (int i = 0; i < 1_000_000; i++) {
      assertFalse(ring.offer(1, 0, 0, 0, null, null, null));
    }
    long ms = (System.nanoTime() - start) / 1_000_000L;
    assertTrue(ms < 5000, "1M offers on a full ring took " + ms + " ms");
    assertEquals(1_000_000L, drops.dropped("q"));
    assertEquals(64, ring.size());
  }

  @Test
  void drainsInOrderAndFreesSlotsForReuse() {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 4, drops);
    Rec rec = new Rec();
    for (int round = 0; round < 3; round++) {
      for (int i = 0; i < 4; i++) {
        assertTrue(ring.offer(i, round, i, 3, "a", "b", "c"));
      }
      assertFalse(ring.offer(9, 0, 0, 0, null, null, null));
      assertEquals(4, ring.drain(256, recording(rec), NO_ERRORS));
    }
    assertEquals(12, rec.rows.size());
    assertEquals("q:0:0:0:3:a:b:c", rec.rows.get(0));
    assertEquals("q:3:2:3:3:a:b:c", rec.rows.get(11));
    assertEquals(3L, drops.dropped("q"));
  }

  @Test
  void drainRespectsBatchLimit() {
    EventRing ring = new EventRing("q", 8, new DropCounters());
    for (int i = 0; i < 8; i++) {
      ring.offer(i, 0, 0, 0, null, null, null);
    }
    assertEquals(3, ring.drain(3, (q, id, t, a, b, c, x, y, z) -> {}, NO_ERRORS));
    assertEquals(5, ring.size());
  }

  @Test
  void drainedSlotsDropStringReferences() {
    EventRing ring = new EventRing("q", 2, new DropCounters());
    ring.offer(1, 0, 0, 0, new String("held"), null, null);
    List<String> seen = new ArrayList<>();
    ring.drain(10, (q, id, t, a, b, c, x, y, z) -> seen.add(x), NO_ERRORS);
    assertEquals(List.of("held"), seen);
  }

  @Test
  void sinkThrowReleasesSlotAndIsCounted() {
    EventRing ring = new EventRing("q", 2, new DropCounters());
    ring.offer(1, 0, 0, 0, null, null, null);
    ring.offer(2, 0, 0, 0, null, null, null);
    int[] errors = {0};
    int n =
        ring.drain(
            10,
            (q, id, t, a, b, c, x, y, z) -> {
              throw new IllegalStateException("boom");
            },
            () -> errors[0]++);
    assertEquals(2, n);
    assertEquals(2, errors[0]);
    assertTrue(ring.offer(3, 0, 0, 0, null, null, null));
  }

  @Test
  void manyProducersLoseNothingAccepted() throws Exception {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 1024, drops);
    int producers = 4;
    int each = 50_000;
    long[] accepted = new long[producers];
    Thread[] ts = new Thread[producers];
    for (int p = 0; p < producers; p++) {
      int pi = p;
      ts[p] =
          new Thread(
              () -> {
                for (int i = 0; i < each; i++) {
                  if (ring.offer(pi, i, 0, 0, null, null, null)) {
                    accepted[pi]++;
                  }
                }
              });
      ts[p].start();
    }
    long[] consumed = {0};
    Sink count = (q, id, t, a, b, c, x, y, z) -> consumed[0]++;
    boolean alive = true;
    while (alive) {
      ring.drain(256, count, NO_ERRORS);
      alive = false;
      for (Thread t : ts) {
        alive |= t.isAlive();
      }
    }
    for (Thread t : ts) {
      t.join();
    }
    ring.drain(Integer.MAX_VALUE, count, NO_ERRORS);
    long total = 0;
    for (long a : accepted) {
      total += a;
    }
    assertEquals(total, consumed[0]);
    assertEquals((long) producers * each - total, drops.dropped("q"));
  }

  @Test
  void offerDoesNotAllocate() {
    com.sun.management.ThreadMXBean mx =
        (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
    EventRing ring = new EventRing("q", 1 << 17, new DropCounters());
    String s = "const";
    for (int i = 0; i < 20_000; i++) { // warm up
      ring.offer(1, i, i, i, s, s, s);
    }
    ring.drain(Integer.MAX_VALUE, (q, id, t, a, b, c, x, y, z) -> {}, NO_ERRORS);
    long tid = Thread.currentThread().threadId();
    long before = mx.getThreadAllocatedBytes(tid);
    for (int i = 0; i < 100_000; i++) {
      ring.offer(1, i, i, i, s, s, s);
    }
    long used = mx.getThreadAllocatedBytes(tid) - before;
    assertTrue(used < 16_384, "allocated " + used + " bytes for 100k offers");
  }
}