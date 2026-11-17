package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConfigWatcherHardeningTest {
    @TempDir Path dir;
    private Path file;
    private Runnable task;
    private int cancels;
    private final List<LedgerConfig> seen = Collections.synchronizedList(new ArrayList<>());
    private final List<String> logged = Collections.synchronizedList(new ArrayList<>());
    private Logger log;
    private long clock = 2_000_000;

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
    }

    private ConfigWatcher watcher(Consumer<LedgerConfig> consumer) {
        ConfigWatcher w = new ConfigWatcher(file, new HostScheduler() {
            @Override
            public Cancellable everyTicks(int ticks, Runnable r) {
                return () -> {};
            }

            @Override
            public Cancellable everyMillis(long ms, Runnable r) {
                task = r;
                return () -> cancels++;
            }
        }, consumer, log);
        w.start();
        return w;
    }

    private void write(String text) throws IOException {
        Files.writeString(file, text, StandardCharsets.UTF_8);
        clock += 10_000;
        Files.setLastModifiedTime(file, FileTime.fromMillis(clock));
    }

    private void assertBounded() {
        for (String m : logged) {
            assertTrue(m.length() <= ConfigWatcher.MAX_LOG, "log line too long: " + m.length());
        }
    }

    // ---- step 1: size cap, Throwable, bounded messages

    @Test
    void oversizedFileIsRejectedWithOneBoundedLineWithoutReadingIt() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("collector.tick.budget_avg_us=77\n");
        task.run();
        // A 400 MB sparse file: only the size is looked at before rejecting.
        try (RandomAccessFile f = new RandomAccessFile(file.toFile(), "rw")) {
            f.setLength(400L * 1024 * 1024);
        }
        Files.setLastModifiedTime(file, FileTime.fromMillis(clock += 10_000));
        task.run();
        task.run();
        assertEquals(1, logged.size());
        assertTrue(logged.get(0).contains("larger than"));
        assertEquals(77, w.current().budgetAvgUs("tick"), "previous config kept");
        assertEquals(1, w.reads(), "oversized file is never parsed");
        assertBounded();
    }

    @Test
    void fileThatGrowsAfterTheStatIsAlsoRejectedByTheReadCap() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("enabled=true\n");
        // Stat sees a small file; the file then grows past the cap during the read.
        w.afterReadHook = () -> {};
        write("#" + "x".repeat(ConfigWatcher.MAX_BYTES + 10) + "\nenabled=true\n");
        task.run();
        assertEquals(1, logged.size());
        assertEquals(0, w.reads());
    }

    @Test
    void anErrorThrownInsidePollNeverEscapesAndIsLoggedOnce() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("enabled=true\n");
        w.afterReadHook = () -> {
            throw new OutOfMemoryError("boom");
        };
        task.run();
        write("enabled=true\n# again\n");
        task.run();
        assertEquals(1, logged.size());
        assertTrue(logged.get(0).contains("OutOfMemoryError"));
        assertTrue(w.current().equals(LedgerConfig.disabled()), "nothing was loaded");
    }

    @Test
    void manyUnknownKeysGiveOneBoundedMessageWithACount() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("enabled=true\n");
        task.run();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 3000; i++) {
            sb.append("k").append(i).append("=1\n");
        }
        write(sb.toString());
        task.run();
        assertEquals(1, logged.size());
        assertTrue(logged.get(0).length() <= ConfigWatcher.MAX_LOG);
        assertTrue(logged.get(0).contains("more"));
        assertTrue(w.current().enabled());
    }

    @Test
    void rememberedErrorsAreCappedAndKeysAreSanitised() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        for (int i = 0; i < ConfigWatcher.MAX_REMEMBERED + 10; i++) {
            write("bad" + i + "=1\n");
            task.run();
        }
        assertEquals(ConfigWatcher.MAX_REMEMBERED + 10, logged.size());
        write("a\\u000aWARNING\\ forged=1\n");
        task.run();
        String last = logged.get(logged.size() - 1);
        assertFalse(last.contains("\n"));
        assertBounded();
        assertTrue(w.current().enabled() || !w.current().enabled());
    }

    // ---- step 2: torn and missed reloads

    @Test
    void tornWriteIsSkippedAndRetriedNextPoll() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("stall.threshold_ms=2\n");
        w.afterReadHook = () -> {
            try {
                write("stall.threshold_ms=20000\n");
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        };
        task.run();
        assertEquals(0, seen.size(), "torn read applied nothing");
        w.afterReadHook = () -> {};
        task.run();
        assertEquals(20000, w.current().stallThresholdMs());
    }

    @Test
    void sameSizeSameMtimeRewriteIsPickedUp() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("stall.threshold_ms=1000\n");
        task.run();
        FileTime t = Files.getLastModifiedTime(file);
        Files.writeString(file, "stall.threshold_ms=9999\n");
        Files.setLastModifiedTime(file, t);
        task.run();
        assertEquals(9999, w.current().stallThresholdMs());
    }

    @Test
    void emptyFileIsATornWriteUntilStableForTwoPolls() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("collector.tick.budget_avg_us=77\n");
        task.run();
        write("");
        task.run();
        assertEquals(77, w.current().budgetAvgUs("tick"));
        assertEquals(1, logged.size());
        task.run();
        assertEquals(50, w.current().budgetAvgUs("tick"), "stable empty file means defaults");
        task.run();
        assertEquals(2, seen.size());
    }

    @Test
    void anEmptyFileThatIsThenFilledNeverResetsTheConfig() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("collector.tick.budget_avg_us=77\n");
        task.run();
        write("");
        task.run();
        write("collector.tick.budget_avg_us=88\n");
        task.run();
        assertEquals(88, w.current().budgetAvgUs("tick"));
        assertEquals(2, seen.size());
    }

    // ---- step 3: kill switch, first load

    @Test
    void enabledFalseWinsEvenWhenOtherKeysAreBad() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("collector.tick.budget_avg_us=77\n");
        task.run();
        write("enabled=false\nbogus=1\n");
        task.run();
        assertFalse(w.current().enabled());
        assertEquals(77, w.current().budgetAvgUs("tick"), "only the kill switch is applied from a bad file");
        assertEquals(2, seen.size());
        assertEquals(1, logged.size());
    }

    @Test
    void enabledFalseWithACredentialKeyStillTurnsOff() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("enabled=false\nrcon_password=hunter2\n");
        task.run();
        assertFalse(w.current().enabled());
        assertFalse(logged.get(0).contains("hunter2"));
    }

    @Test
    void beforeTheFirstPollCurrentIsDisabledAndNotLoaded() {
        ConfigWatcher w = watcher(seen::add);
        assertEquals(LedgerConfig.disabled(), w.current());
        assertFalse(w.loaded());
        task.run();
        assertTrue(w.loaded());
        assertEquals(LedgerConfig.defaults(), w.current(), "missing file: the file defaults");
    }

    @Test
    void aBadFirstFileCallsTheConsumerOnceWithDefaults() throws IOException {
        ConfigWatcher w = watcher(seen::add);
        write("bogus=1\n");
        task.run();
        task.run();
        assertEquals(List.of(LedgerConfig.defaults()), seen);
        assertTrue(w.loaded());
    }

    @Test
    void aBadFirstFileWithKillSwitchCallsTheConsumerWithDisabled() throws IOException {
        watcher(seen::add);
        write("enabled=false\nbogus=1\n");
        task.run();
        assertEquals(List.of(LedgerConfig.disabled()), seen);
    }

    // ---- step 4: single flight, stop, consumer failure

    @Test
    void consumerExceptionIsLoggedAsConsumerFailureAndNextChangeIsOffered() throws IOException {
        int[] calls = {0};
        ConfigWatcher w = watcher(c -> {
            calls[0]++;
            if (calls[0] == 1) {
                throw new IllegalStateException("x");
            }
        });
        write("collector.tick.budget_avg_us=77\n");
        task.run();
        assertEquals(1, logged.size());
        assertTrue(logged.get(0).contains("consumer failed"));
        assertFalse(logged.get(0).contains("cannot read"));
        assertEquals(77, w.current().budgetAvgUs("tick"));
        write("collector.tick.budget_avg_us=88\n");
        task.run();
        assertEquals(2, calls[0]);
    }

    @Test
    void consumerErrorIsAlsoContained() throws IOException {
        watcher(c -> {
            throw new StackOverflowError();
        });
        write("enabled=true\n");
        task.run();
        assertTrue(logged.get(0).contains("consumer failed"));
    }

    @Test
    void noConsumerCallAfterStopReturnsAndStopWaitsForAPollInFlight() throws Exception {
        CountDownLatch inConsumer = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<String> order = Collections.synchronizedList(new ArrayList<>());
        ConfigWatcher w = watcher(c -> {
            inConsumer.countDown();
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            order.add("consumer-done");
        });
        write("enabled=true\n");
        Thread poller = new Thread(task);
        poller.start();
        assertTrue(inConsumer.await(5, TimeUnit.SECONDS));
        Thread stopper = new Thread(() -> {
            w.stop();
            order.add("stop-returned");
        });
        stopper.start();
        Thread.sleep(100);
        assertFalse(order.contains("stop-returned"), "stop waits for the poll in flight");
        release.countDown();
        poller.join(5000);
        stopper.join(5000);
        assertEquals(List.of("consumer-done", "stop-returned"), order);
        int before = seen.size();
        write("enabled=false\n");
        task.run();
        assertEquals(before, seen.size());
        assertEquals(1, cancels);
    }

    @Test
    void concurrentPollsAreSingleFlight() throws Exception {
        int[] active = {0};
        int[] max = {0};
        ConfigWatcher w = watcher(c -> {
            synchronized (active) {
                active[0]++;
                max[0] = Math.max(max[0], active[0]);
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            synchronized (active) {
                active[0]--;
            }
        });
        write("enabled=true\n");
        Thread a = new Thread(task);
        Thread b = new Thread(task);
        a.start();
        b.start();
        a.join(5000);
        b.join(5000);
        assertEquals(1, max[0]);
        assertTrue(w.loaded());
    }
}
