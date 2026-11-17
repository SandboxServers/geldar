package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConfigWatcherTest {
    /** Minimal scheduler: remembers the async task and every call kind. */
    private static final class FakeScheduler implements HostScheduler {
        final List<Long> millisPeriods = new ArrayList<>();
        int tickCalls;
        int cancels;
        Runnable task;

        @Override
        public Cancellable everyTicks(int ticks, Runnable r) {
            tickCalls++;
            return () -> {};
        }

        @Override
        public Cancellable everyMillis(long ms, Runnable r) {
            millisPeriods.add(ms);
            task = r;
            return () -> cancels++;
        }
    }

    @TempDir Path dir;
    private Path file;
    private final FakeScheduler sched = new FakeScheduler();
    private final List<LedgerConfig> seen = new ArrayList<>();
    private final List<String> logged = new ArrayList<>();
    private Logger log;
    private ConfigWatcher watcher;
    private long clock = 1_000_000;

    @BeforeEach
    void setUp() {
        file = dir.resolve("ledger.properties");
        log = Logger.getAnonymousLogger();
        log.setUseParentHandlers(false);
        log.addHandler(new Handler() {
            @Override
            public void publish(LogRecord r) {
                logged.add(r.getMessage());
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        watcher = new ConfigWatcher(file, sched, seen::add, log);
        watcher.start();
    }

    private void write(String text) throws IOException {
        Files.writeString(file, text, StandardCharsets.UTF_8);
        clock += 10_000;
        Files.setLastModifiedTime(file, FileTime.fromMillis(clock));
    }

    @Test
    void usesOnlyEveryMillisAt5000AndNeverEveryTicks() {
        assertEquals(List.of(5000L), sched.millisPeriods);
        sched.task.run();
        assertEquals(0, sched.tickCalls);
        watcher.start(); // idempotent
        assertEquals(1, sched.millisPeriods.size());
    }

    @Test
    void missingFileMeansDefaultsAndIsNotReread() {
        sched.task.run();
        sched.task.run();
        assertEquals(LedgerConfig.defaults(), watcher.current());
        assertEquals(0, watcher.reads());
        assertEquals(1, seen.size());
    }

    @Test
    void picksUpAValidEditAndIgnoresAnUnchangedFile() throws IOException {
        write("enabled=true\n");
        sched.task.run();
        assertEquals(1, watcher.reads());
        sched.task.run();
        sched.task.run();
        assertEquals(1, watcher.reads(), "unchanged file must not be re-read");

        write("collector.tick.enabled=false\n");
        sched.task.run();
        assertEquals(2, watcher.reads());
        assertFalse(watcher.current().collectorEnabled("tick"));
        assertEquals(2, seen.size());
        assertFalse(seen.get(1).collectorEnabled("tick"));
    }

    @Test
    void invalidEditKeepsTheLastGoodSnapshotAndLogsOncePerDistinctError() throws IOException {
        write("collector.tick.budget_avg_us=77\n");
        sched.task.run();
        assertEquals(77, watcher.current().budgetAvgUs("tick"));

        write("nonsense=1\n");
        sched.task.run();
        assertEquals(77, watcher.current().budgetAvgUs("tick"));
        assertEquals(1, logged.size());
        // Same error again (file touched, same content): no second log line.
        write("nonsense=1\n");
        sched.task.run();
        assertEquals(1, logged.size());
        // A different error logs again.
        write("another=1\n");
        sched.task.run();
        assertEquals(2, logged.size());
        assertEquals(77, watcher.current().budgetAvgUs("tick"));
        assertEquals(1, seen.size(), "no swap on a bad file");
    }

    @Test
    void credentialKeyIsRejectedNothingAppliedAndValueNotLogged() throws IOException {
        write("rcon_password=hunter2\ncollector.tick.budget_avg_us=77\n");
        sched.task.run();
        assertTrue(watcher.current().enabled());
        assertEquals(50, watcher.current().budgetAvgUs("tick"), "nothing from a credential file is applied");
        assertEquals(1, logged.size());
        assertFalse(logged.get(0).contains("hunter2"));
    }

    @Test
    void deletingTheFileReturnsToDefaultsAndStopCancels() throws IOException {
        write("enabled=false\n");
        sched.task.run();
        assertFalse(watcher.current().enabled());
        Files.delete(file);
        sched.task.run();
        assertTrue(watcher.current().enabled());
        watcher.stop();
        watcher.stop();
        assertEquals(1, sched.cancels);
    }
}
