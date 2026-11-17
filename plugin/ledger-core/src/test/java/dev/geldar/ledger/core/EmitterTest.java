package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

@Timeout(value = 60, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class EmitterTest {
  private static void awaitTrue(java.util.function.BooleanSupplier c, long ms) throws Exception {
    long end = System.nanoTime() + ms * 1_000_000L;
    while (!c.getAsBoolean() && System.nanoTime() < end) {
      Thread.sleep(5);
    }
  }

  @Test
  void drainsRingsIntoSink() throws Exception {
    EventRing ring = new EventRing("q", 64, new DropCounters());
    AtomicInteger got = new AtomicInteger();
    try (Emitter e =
        new Emitter("t", List.of(ring), (q, id, t, a, b, c, x, y, z) -> got.incrementAndGet())
            .start()) {
      for (int i = 0; i < 40; i++) {
        ring.offer(1, 0, 0, 0, null, null, null);
      }
      awaitTrue(() -> got.get() == 40, 3000);
      assertEquals(40, got.get());
    }
  }

  @Test
  void throwingSinkDoesNotKillThreadAndErrorsAreCounted() throws Exception {
    EventRing ring = new EventRing("q", 64, new DropCounters());
    AtomicInteger calls = new AtomicInteger();
    try (Emitter e =
        new Emitter(
                "t",
                List.of(ring),
                (q, id, t, a, b, c, x, y, z) -> {
                  calls.incrementAndGet();
                  throw new Error("sink down");
                })
            .start()) {
      ring.offer(1, 0, 0, 0, null, null, null);
      awaitTrue(() -> calls.get() == 1, 3000);
      ring.offer(2, 0, 0, 0, null, null, null);
      awaitTrue(() -> calls.get() == 2, 3000);
      assertEquals(2, calls.get());
      awaitTrue(() -> e.sinkErrors() == 2, 3000);
      assertEquals(2, e.sinkErrors());
    }
  }

  @Test
  void blockingSinkNeverStopsProducersAndDropsAreCounted() throws Exception {
    DropCounters drops = new DropCounters();
    EventRing ring = new EventRing("q", 64, drops);
    CountDownLatch entered = new CountDownLatch(1);
    Sink blocker =
        (q, id, t, a, b, c, x, y, z) -> {
          entered.countDown();
          long end = System.nanoTime() + 5_000_000_000L;
          while (System.nanoTime() < end) { // ignores interrupts, like a stuck socket
            try {
              Thread.sleep(50);
            } catch (InterruptedException ignored) {
              // keep blocking
            }
          }
        };
    Emitter e = new Emitter("t", List.of(ring), blocker).start();
    ring.offer(1, 0, 0, 0, null, null, null);
    assertTrue(entered.await(3, TimeUnit.SECONDS));
    long start = System.nanoTime();
    int accepted = 0;
    for (int i = 0; i < 1000; i++) {
      if (ring.offer(1, 0, 0, 0, null, null, null)) {
        accepted++;
      }
    }
    long ms = (System.nanoTime() - start) / 1_000_000L;
    assertTrue(ms < 1000, "producer blocked for " + ms + " ms");
    assertEquals(64, accepted);
    assertEquals(1000 - 64, drops.dropped("q"));
    long c0 = System.nanoTime();
    e.close();
    long closeMs = (System.nanoTime() - c0) / 1_000_000L;
    assertTrue(closeMs < 1500, "close took " + closeMs + " ms");
  }

  @Test
  void closeStopsThreadWithinOneSecond() throws Exception {
    Emitter e = new Emitter("t-close", List.of(), (q, id, t, a, b, c, x, y, z) -> {}).start();
    long c0 = System.nanoTime();
    e.close();
    assertTrue((System.nanoTime() - c0) / 1_000_000L < 1000);
    assertFalse(
        Thread.getAllStackTraces().keySet().stream()
            .anyMatch(t -> t.getName().equals("t-close") && t.isAlive()));
  }

  @Test
  void closeFlushesQueuedRecords() {
    EventRing ring = new EventRing("q", 64, new DropCounters());
    AtomicInteger got = new AtomicInteger();
    Emitter e =
        new Emitter(
                "t-flush",
                List.of(ring),
                (q, id, t, a, b, c, x, y, z) -> {
                  try {
                    Thread.sleep(10);
                  } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                  }
                  got.incrementAndGet();
                })
            .start();
    for (int i = 0; i < 10; i++) {
      ring.offer(1, 0, 0, 0, null, null, null);
    }
    e.close();
    assertEquals(10, got.get());
    assertEquals(0, ring.size());
  }

  @Test
  void noSinkCallStartsAfterCloseReturns() throws Exception {
    EventRing ring = new EventRing("q", 64, new DropCounters());
    AtomicInteger calls = new AtomicInteger();
    CountDownLatch entered = new CountDownLatch(1);
    Sink stuck =
        (q, id, t, a, b, c, x, y, z) -> {
          calls.incrementAndGet();
          entered.countDown();
          long end = System.nanoTime() + 1_600_000_000L;
          while (System.nanoTime() < end) { // ignores interrupts, like a stuck socket
            try {
              Thread.sleep(20);
            } catch (InterruptedException ignored) {
              // keep blocking
            }
          }
        };
    Emitter e = new Emitter("t-stuck", List.of(ring), stuck).start();
    for (int i = 0; i < 30; i++) {
      ring.offer(1, 0, 0, 0, null, null, null);
    }
    assertTrue(entered.await(3, TimeUnit.SECONDS));
    long c0 = System.nanoTime();
    e.close();
    assertTrue((System.nanoTime() - c0) / 1_000_000L < 1500);
    int atClose = calls.get();
    Thread.sleep(1500); // the stuck call returns; the thread must not take another record
    assertEquals(atClose, calls.get());
    assertEquals(1, atClose);
  }

  @Test
  void flushIsBoundedByTheDeadline() throws Exception {
    EventRing ring = new EventRing("q", 256, new DropCounters());
    AtomicInteger got = new AtomicInteger();
    Sink slow =
        (q, id, t, a, b, c, x, y, z) -> {
          try {
            Thread.sleep(50);
          } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
          }
          got.incrementAndGet();
        };
    Emitter e = new Emitter("t-slow", List.of(ring), slow).start();
    for (int i = 0; i < 200; i++) { // 10 s of work at 50 ms each
      ring.offer(1, 0, 0, 0, null, null, null);
    }
    long c0 = System.nanoTime();
    e.close();
    assertTrue((System.nanoTime() - c0) / 1_000_000L < 1500);
    int atClose = got.get();
    assertTrue(atClose < 200, "delivered " + atClose);
    Thread.sleep(300);
    assertEquals(atClose, got.get());
  }
}