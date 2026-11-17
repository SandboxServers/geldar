package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;
import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
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

  private static WeakReference<String> offerFreshString(EventRing ring) {
    String held = new String(new char[] {'h', 'e', 'l', 'd'});
    ring.offer(1, 0, 0, 0, held, null, null);
    return new WeakReference<>(held);
  }

  @Test
  void drainedSlotsDropStringReferences() throws Exception {
    EventRing ring = new EventRing("q", 2, new DropCounters());
    WeakReference<String> ref = offerFreshString(ring);
    assertEquals(1, ring.drain(10, (q, id, t, a, b, c, x, y, z) -> {}, NO_ERRORS));
    for (int i = 0; i < 100 && ref.get() != null; i++) {
      System.gc();
      Thread.sleep(20);
    }
    assertEquals(null, ref.get(), "the drained slot still pins its string");
  }

  @Test
  void throwingClockNeverPoisonsTheRing() {
    AtomicInteger calls = new AtomicInteger();
    EventRing ring =
        new EventRing(
            "q",
            64,
            new DropCounters(),
            () -> {
              if (calls.incrementAndGet() % 3 == 0) {
                throw new IllegalStateException("clock down");
              }
              return 7L;
            });
    for (int i = 0; i < 30; i++) {
      assertTrue(ring.offer(1, i, 0, 0, null, null, null), "offer " + i);
    }
    long[] last = {-1};
    assertEquals(30, ring.drain(256, (q, id, t, a, b, c, x, y, z) -> last[0] = a, NO_ERRORS));
    assertEquals(29, last[0]);
    assertEquals(0, ring.size());
  }

  @Test
  void stopSetAfterTakingARecordKeepsItFromTheSinkAndCountsADrop() {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 8, drops);
    ring.offer(1, 0, 0, 0, null, null, null);
    int[] polls = {0};
    int[] delivered = {0};
    // false at the loop top, true just before the sink call.
    int n =
        ring.drain(10, (q, id, t, a, b, c, x, y, z) -> delivered[0]++, NO_ERRORS, () -> polls[0]++ >= 1);
    assertEquals(1, n);
    assertEquals(0, delivered[0]);
    assertEquals(1L, drops.dropped("q"));
  }

  @Test
  void drainStopsTakingRecordsOnceStopIsSet() {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 8, drops);
    for (int i = 0; i < 8; i++) {
      ring.offer(1, i, 0, 0, null, null, null);
    }
    int[] delivered = {0};
    boolean[] stop = {false};
    int n =
        ring.drain(
            100,
            (q, id, t, a, b, c, x, y, z) -> {
              delivered[0]++;
              stop[0] = true;
            },
            NO_ERRORS,
            () -> stop[0]);
    assertEquals(1, n);
    assertEquals(1, delivered[0]);
    assertEquals(7, ring.size());
    assertEquals(0, ring.drain(100, (q, id, t, a, b, c, x, y, z) -> delivered[0]++, NO_ERRORS, () -> true));
    assertEquals(1, delivered[0]);
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
  void manyProducersLoseNothingAndRecordsAreIntact() throws Exception {
    for (int capacity : new int[] {2, 4, 64, 1024}) {
      producersRound(capacity);
    }
  }

  /** Each record carries (id=p, a=i, b=3p, c=~i, "p<p>"): a torn or reordered slot breaks the pattern. */
  private static void producersRound(int capacity) throws Exception {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", capacity, drops);
    int producers = 6;
    int each = 150_000;
    long[] accepted = new long[producers];
    Thread[] ts = new Thread[producers];
    for (int p = 0; p < producers; p++) {
      int pi = p;
      String tag = "p" + pi;
      ts[p] =
          new Thread(
              () -> {
                for (int i = 0; i < each; i++) {
                  if (ring.offer(pi, i, pi * 3L, ~(long) i, tag, tag, tag)) {
                    accepted[pi]++;
                  }
                }
              });
      ts[p].start();
    }
    long[] consumed = new long[producers];
    long[] lastSeen = new long[producers];
    java.util.Arrays.fill(lastSeen, -1);
    AtomicInteger bad = new AtomicInteger();
    Sink check =
        (q, id, t, a, b, c, x, y, z) -> {
          String tag = "p" + id;
          if (id < 0 || id >= producers || b != id * 3L || c != ~a || !tag.equals(x) || !tag.equals(y)
              || !tag.equals(z) || a <= lastSeen[id]) {
            bad.incrementAndGet();
            return;
          }
          lastSeen[id] = a;
          consumed[id]++;
        };
    boolean alive = true;
    while (alive) {
      ring.drain(256, check, NO_ERRORS);
      alive = false;
      for (Thread t : ts) {
        alive |= t.isAlive();
      }
    }
    for (Thread t : ts) {
      t.join();
    }
    ring.drain(Integer.MAX_VALUE, check, NO_ERRORS);
    assertEquals(0, bad.get(), "corrupt or reordered records, capacity " + capacity);
    long total = 0;
    for (int p = 0; p < producers; p++) {
      assertEquals(accepted[p], consumed[p], "producer " + p);
      total += accepted[p];
    }
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