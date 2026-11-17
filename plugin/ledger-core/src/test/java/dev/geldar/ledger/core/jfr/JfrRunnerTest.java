package dev.geldar.ledger.core.jfr;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.DropCounters;
import dev.geldar.ledger.core.LedgerConfig;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import jdk.jfr.consumer.RecordedEvent;
import org.junit.jupiter.api.Test;

class JfrRunnerTest {
    private static final Logger LOG = Logger.getLogger("jfr-test");
    private static final String MONITOR = "jdk.JavaMonitorEnter";
    private static final long DEADLINE_MS = 15_000;

    private static JfrSettings fastSettings() {
        return JfrSettings.defaults().with(MONITOR, JfrSettings.Setting.threshold(Duration.ofMillis(1)));
    }

    private static final class Recording implements JfrHandler {
        final List<String> names;
        final AtomicInteger seen = new AtomicInteger();
        final boolean throwing;

        Recording(boolean throwing, String... names) {
            this.throwing = throwing;
            this.names = List.of(names);
        }

        @Override
        public List<String> eventNames() {
            return names;
        }

        @Override
        public void handle(RecordedEvent event) {
            seen.incrementAndGet();
            if (throwing) {
                throw new IllegalStateException("handler failure");
            }
        }
    }

    /** Creates monitor contention until the predicate holds or the deadline passes. */
    private static boolean contendUntil(java.util.function.BooleanSupplier done) throws InterruptedException {
        Object lock = new Object();
        long end = System.currentTimeMillis() + DEADLINE_MS;
        while (!done.getAsBoolean() && System.currentTimeMillis() < end) {
            java.util.concurrent.CountDownLatch held = new java.util.concurrent.CountDownLatch(1);
            Thread holder = new Thread(() -> {
                synchronized (lock) {
                    held.countDown();
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
            });
            holder.start();
            held.await();
            synchronized (lock) {
                // blocked on entry until holder releases: a JavaMonitorEnter event
            }
            holder.join();
            Thread.sleep(20);
        }
        return done.getAsBoolean();
    }

    private static boolean threadAlive() {
        return Thread.getAllStackTraces().keySet().stream().anyMatch(t -> JfrRunner.THREAD_NAME.equals(t.getName()) && t.isAlive());
    }

    @Test
    void deliversAContentionEventToTheHandler() throws Exception {
        Recording h = new Recording(false, MONITOR);
        JfrRunner r = JfrRunner.start(List.of(h), LedgerConfig.defaults(), LOG, new DropCounters(), fastSettings());
        try {
            assertTrue(r.running());
            assertTrue(contendUntil(() -> h.seen.get() >= 1), "no JavaMonitorEnter event seen");
        } finally {
            r.stop();
        }
    }

    @Test
    void stopLeavesNoLedgerJfrThreadAndIsIdempotent() throws Exception {
        Recording h = new Recording(false, MONITOR);
        JfrRunner r = JfrRunner.start(List.of(h), LedgerConfig.defaults(), LOG, new DropCounters(), fastSettings());
        assertTrue(threadAlive());
        r.stop();
        r.stop();
        assertFalse(r.running());
        assertFalse(threadAlive());
    }

    @Test
    void runnerThreadIsADaemon() {
        Recording h = new Recording(false, MONITOR);
        JfrRunner r = JfrRunner.start(List.of(h), LedgerConfig.defaults(), LOG, new DropCounters(), fastSettings());
        try {
            Thread t = Thread.getAllStackTraces().keySet().stream()
                    .filter(x -> JfrRunner.THREAD_NAME.equals(x.getName()))
                    .findFirst()
                    .orElseThrow();
            assertTrue(t.isDaemon());
        } finally {
            r.stop();
        }
    }

    @Test
    void throwingHandlerDoesNotKillTheStreamAndIsCounted() throws Exception {
        Recording bad = new Recording(true, MONITOR);
        Recording good = new Recording(false, MONITOR);
        DropCounters drops = new DropCounters();
        JfrRunner r = JfrRunner.start(List.of(bad, good), LedgerConfig.defaults(), LOG, drops, fastSettings());
        try {
            assertTrue(contendUntil(() -> good.seen.get() >= 2), "stream stopped after a handler threw");
            assertTrue(bad.seen.get() >= 2);
            assertTrue(r.running());
            assertTrue(drops.dropped("jfr") >= 2, "handler failures must be counted in queue=jfr");
            assertEquals(drops.dropped("jfr"), r.dropped());
        } finally {
            r.stop();
        }
    }

    private static Set<String> listing(Path dir) throws IOException {
        try (Stream<Path> s = Files.list(dir)) {
            return s.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(".jfr")).collect(Collectors.toSet());
        }
    }

    @Test
    void writesNoRecordingFileToTempOrWorkingDir() throws Exception {
        Path tmp = Paths.get(System.getProperty("java.io.tmpdir"));
        Path cwd = Paths.get("").toAbsolutePath();
        Set<String> tmpBefore = listing(tmp);
        Set<String> cwdBefore = listing(cwd);
        Recording h = new Recording(false, MONITOR);
        JfrRunner r = JfrRunner.start(List.of(h), LedgerConfig.defaults(), LOG, new DropCounters(), fastSettings());
        try {
            contendUntil(() -> h.seen.get() >= 1);
        } finally {
            r.stop();
        }
        assertEquals(tmpBefore, listing(tmp));
        assertEquals(cwdBefore, listing(cwd));
    }

    @Test
    void enablesOnlyEventsHandlersRequestedAndAllowed() {
        Recording h = new Recording(false, MONITOR, "jdk.ExecutionSample", "jdk.CPUTimeSample", "jdk.MethodTiming", "jdk.NotAnEvent");
        JfrRunner r = JfrRunner.start(List.of(h), LedgerConfig.defaults(), LOG, new DropCounters(), fastSettings());
        try {
            assertEquals(List.of(MONITOR), r.enabledEvents());
        } finally {
            r.stop();
        }
    }

    @Test
    void settingsResolveNamesOnlyRequestedEvents() {
        Map<String, JfrSettings.Setting> m = JfrSettings.defaults().resolve(List.of("jdk.FileRead"));
        assertEquals(Set.of("jdk.FileRead"), m.keySet());
        assertEquals(JfrSettings.Setting.threshold(Duration.ofMillis(10)), m.get("jdk.FileRead"));
        assertTrue(JfrSettings.defaults().resolve(List.of()).isEmpty());
    }

    @Test
    void deniedEventsCannotBeAllowedByAnyConfiguration() {
        for (String denied : JfrSettings.DENIED) {
            JfrSettings s = JfrSettings.defaults().with(denied, JfrSettings.Setting.period(Duration.ofMillis(10)));
            assertTrue(s.resolve(List.of(denied)).isEmpty(), denied);
            assertFalse(new JfrSettings(Map.of(denied, JfrSettings.Setting.period(Duration.ofSeconds(1)))).allowed().contains(denied));
        }
        assertTrue(JfrSettings.DENIED.containsAll(Set.of("jdk.ExecutionSample", "jdk.CPUTimeSample", "jdk.MethodTiming", "jdk.MethodTrace")));
    }

    @Test
    void defaultsCarryTheCardValues() {
        JfrSettings s = JfrSettings.defaults();
        assertEquals(JfrSettings.Setting.period(Duration.ofSeconds(10)), s.resolve(List.of("jdk.ThreadCPULoad")).get("jdk.ThreadCPULoad"));
        assertEquals(JfrSettings.Setting.threshold(Duration.ofMillis(20)), s.resolve(List.of(MONITOR)).get(MONITOR));
        assertEquals(JfrSettings.Setting.period(Duration.ofSeconds(60)), s.resolve(List.of("jdk.ExceptionStatistics")).get("jdk.ExceptionStatistics"));
        assertEquals(JfrSettings.Setting.threshold(Duration.ofMillis(10)), s.resolve(List.of("jdk.SafepointBegin")).get("jdk.SafepointBegin"));
        assertEquals(Set.of("jdk.FileRead"), s.allowOnly(List.of("jdk.FileRead", "jdk.Nope")).allowed());
    }

    @Test
    void offWhenConfigDisablesJfrOrMasterSwitchOrNoHandlers() {
        LedgerConfig d = LedgerConfig.defaults();
        LedgerConfig jfrOff = new LedgerConfig(true, d.collectorEnabled(), d.budgetAvgUs(), d.budgetMaxUs(), d.duty(), d.rates(),
                d.queueCapacity(), d.contentMaxBytes(), d.stallThresholdMs(), d.sampleWorldEveryTicks(), d.samplePlayerEveryTicks(), false);
        Recording h = new Recording(false, MONITOR);
        for (JfrRunner r : List.of(
                JfrRunner.start(List.of(h), jfrOff, LOG, new DropCounters(), fastSettings()),
                JfrRunner.start(List.of(h), LedgerConfig.disabled(), LOG, new DropCounters(), fastSettings()),
                JfrRunner.start(List.of(), d, LOG, new DropCounters(), fastSettings()))) {
            assertFalse(r.running());
            assertTrue(r.enabledEvents().isEmpty());
            r.stop();
        }
        assertFalse(threadAlive());
    }

    @Test
    void startNeverThrowsWithNullConfigOrBadHandler() {
        JfrHandler broken = new JfrHandler() {
            @Override
            public List<String> eventNames() {
                throw new IllegalStateException("broken");
            }

            @Override
            public void handle(RecordedEvent event) {}
        };
        JfrRunner a = JfrRunner.start(List.of(broken), LedgerConfig.defaults(), LOG);
        JfrRunner b = JfrRunner.start(List.of(), null, LOG);
        assertFalse(a.running());
        assertFalse(b.running());
        a.stop();
        b.stop();
        assertFalse(threadAlive());
    }

    @Test
    void jfrIsAvailableOnThisJdk() {
        assertTrue(JfrRunner.available());
    }
}
