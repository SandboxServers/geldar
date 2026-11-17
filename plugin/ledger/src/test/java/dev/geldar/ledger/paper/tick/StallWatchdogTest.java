package dev.geldar.ledger.paper.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class StallWatchdogTest {
    final Semaphore permits = new Semaphore(0);
    final Semaphore asleep = new Semaphore(0);
    final AtomicInteger runs = new AtomicInteger();
    volatile Thread thread;

    StallWatchdog.Sleeper sleeper() {
        return ms -> {
            thread = Thread.currentThread();
            assertEquals(500, ms);
            asleep.release();
            permits.acquire();
        };
    }

    private void step() throws Exception {
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
    }

    @Test
    void aCheckThatThrowsDoesNotKillTheThread() throws Exception {
        StallWatchdog w = new StallWatchdog(500, sleeper(), () -> {
            if (runs.incrementAndGet() == 1) {
                throw new IllegalStateException("boom");
            }
        });
        w.start();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        step();
        step();
        assertEquals(2, runs.get());
        assertTrue(w.running());
        assertTrue(thread.isDaemon());
        assertEquals(StallWatchdog.THREAD_NAME, thread.getName());
        w.stop();
        assertFalse(thread.isAlive());
    }

    @Test
    void aThrowingSleeperEndsTheThreadWithoutSpinning() throws Exception {
        StallWatchdog w = new StallWatchdog(500, ms -> {
            throw new IllegalStateException("x");
        }, runs::incrementAndGet);
        w.start();
        for (int i = 0; i < 100 && w.running(); i++) {
            Thread.sleep(20);
        }
        assertFalse(w.running());
        assertEquals(0, runs.get());
        w.stop();
        w.stop();
    }
}
