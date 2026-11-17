package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class NeoForgeHostTest {
    @Test
    void hostInfoReportsSuppliersAndLoaderName() {
        NeoForgeHostInfo info = new NeoForgeHostInfo(() -> 7L, () -> true);
        assertEquals(7L, info.serverTick());
        assertTrue(info.isMainThread());
        assertEquals("neoforge", info.loaderName());
        assertFalse(new NeoForgeHostInfo(() -> 0L, () -> false).isMainThread());
    }

    @Test
    void tickTaskRunsEveryNTicksAndStopsWhenCancelled() {
        try (NeoForgeHostScheduler s = new NeoForgeHostScheduler()) {
            AtomicInteger runs = new AtomicInteger();
            Cancellable c = s.everyTicks(3, runs::incrementAndGet);
            for (int i = 0; i < 6; i++) {
                s.onServerTick();
            }
            assertEquals(2, runs.get());
            assertEquals(6L, s.serverTick());
            c.cancel();
            for (int i = 0; i < 6; i++) {
                s.onServerTick();
            }
            assertEquals(2, runs.get());
        }
    }

    @Test
    void throwingTickTaskDoesNotStopTheTickOrOthers() {
        try (NeoForgeHostScheduler s = new NeoForgeHostScheduler()) {
            AtomicInteger runs = new AtomicInteger();
            s.everyTicks(1, () -> {
                throw new IllegalStateException("boom");
            });
            s.everyTicks(1, runs::incrementAndGet);
            s.onServerTick();
            s.onServerTick();
            assertEquals(2, runs.get());
        }
    }

    @Test
    void millisTaskRunsOffTheCallerThreadSurvivesAThrowAndStopsAfterClose() throws Exception {
        NeoForgeHostScheduler s = new NeoForgeHostScheduler();
        AtomicInteger runs = new AtomicInteger();
        CountDownLatch twice = new CountDownLatch(2);
        Thread caller = Thread.currentThread();
        boolean[] offThread = {true};
        s.everyMillis(5, () -> {
            offThread[0] &= Thread.currentThread() != caller;
            runs.incrementAndGet();
            twice.countDown();
            throw new IllegalStateException("boom");
        });
        assertTrue(twice.await(5, TimeUnit.SECONDS), "task must keep running after a throw");
        assertTrue(offThread[0]);
        s.close();
        Thread.sleep(50);
        int after = runs.get();
        Thread.sleep(50);
        assertEquals(after, runs.get());
    }
}