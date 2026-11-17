package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class NeoForgeHostTest {
    private static final Logger LOG = Logger.getLogger("ledger-test");

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
        try (NeoForgeHostScheduler s = new NeoForgeHostScheduler(LOG)) {
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
        try (NeoForgeHostScheduler s = new NeoForgeHostScheduler(LOG)) {
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
        NeoForgeHostScheduler s = new NeoForgeHostScheduler(LOG);
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

    @Test
    void errorsInTickAndAsyncTasksAreContained() throws Exception {
        NeoForgeHostScheduler s = new NeoForgeHostScheduler(LOG);
        AtomicInteger runs = new AtomicInteger();
        s.everyTicks(1, () -> {
            throw new NoClassDefFoundError("x");
        });
        s.everyTicks(1, runs::incrementAndGet);
        s.onServerTick();
        s.onServerTick();
        assertEquals(2, runs.get());
        CountDownLatch twice = new CountDownLatch(2);
        s.everyMillis(5, () -> {
            twice.countDown();
            throw new AssertionError();
        });
        assertTrue(twice.await(5, TimeUnit.SECONDS), "async task must survive an Error");
        s.close();
    }

    @Test
    void failureIsLoggedOncePerTask() {
        java.util.List<String> lines = new java.util.concurrent.CopyOnWriteArrayList<>();
        Logger log = Logger.getAnonymousLogger();
        log.setUseParentHandlers(false);
        log.addHandler(new java.util.logging.Handler() {
            @Override public void publish(java.util.logging.LogRecord r) { lines.add(r.getMessage()); }
            @Override public void flush() {}
            @Override public void close() {}
        });
        try (NeoForgeHostScheduler s = new NeoForgeHostScheduler(log)) {
            s.everyTicks(1, () -> {
                throw new IllegalStateException("secret text");
            });
            s.onServerTick();
            s.onServerTick();
        }
        assertEquals(1, lines.size());
        assertTrue(lines.get(0).contains("IllegalStateException"));
        assertFalse(lines.get(0).contains("secret"));
    }

    @Test
    void schedulingAfterCloseIsAContainedNoOp() {
        NeoForgeHostScheduler s = new NeoForgeHostScheduler(LOG);
        s.close();
        AtomicInteger runs = new AtomicInteger();
        s.everyMillis(1, runs::incrementAndGet).cancel();
        s.everyTicks(1, runs::incrementAndGet).cancel();
        s.onServerTick();
        assertEquals(0, runs.get());
    }
}