package dev.geldar.ledger.core.container;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CgroupReaderTest {
    @TempDir
    Path dir;

    private void w(String name, String text) throws IOException {
        Files.writeString(dir.resolve(name), text);
    }

    private void full() throws IOException {
        w(
                "cpu.stat",
                "usage_usec 999\nuser_usec 1\nsystem_usec 2\nnr_periods 200\nnr_throttled 50\nthrottled_usec 2500000\n"
                        + "nr_bursts 0\nfuture_field 7\n");
        w("memory.current", "123456\n");
        w("memory.max", "2048\n");
        w("memory.events", "low 0\nhigh 0\nmax 4\noom 2\noom_kill 1\n");
        w("pids.current", "37\n");
        w("pids.max", "max\n");
    }

    @Test
    void parsesAllFilesExactly() throws IOException {
        full();
        var s = new CgroupReader(dir).read();
        assertNotNull(s);
        assertEquals(200, s.periods());
        assertEquals(50, s.throttledPeriods());
        assertEquals(2_500_000, s.throttledUsec());
        assertEquals(123456, s.memoryCurrent());
        assertEquals(2048, s.memoryLimit());
        assertEquals(2, s.oom());
        assertEquals(1, s.oomKill());
        assertEquals(37, s.pidsCurrent());
        assertEquals(0, s.pidsMax());
    }

    @Test
    void throttledSecondsAndRatio() throws IOException {
        full();
        var s = new CgroupReader(dir).read();
        assertEquals(2.5, s.throttledSeconds(), 1e-12);
        assertEquals(0.25, s.throttledRatio(), 1e-12);
        w("cpu.stat", "nr_periods 0\nnr_throttled 0\nthrottled_usec 0\n");
        assertEquals(0.0, new CgroupReader(dir).read().throttledRatio());
    }

    @Test
    void memoryMaxMaxMeansUnlimited() throws IOException {
        full();
        w("memory.max", "max\n");
        assertEquals(0, new CgroupReader(dir).read().memoryLimit());
    }

    @Test
    void missingCpuStatIsUnavailableWithoutThrowing() throws IOException {
        full();
        Files.delete(dir.resolve("cpu.stat"));
        assertNull(new CgroupReader(dir).read());
        assertNull(new CgroupReader(dir.resolve("nope")).read());
    }

    @Test
    void cpuStatMissingFieldsReadAsZeroAndMalformedLinesAreSkipped() throws IOException {
        full();
        w("cpu.stat", "nr_periods 10\nnr_throttled abc\nthrottled_usec -5\ngarbage\n\nnr_periods\n");
        var s = new CgroupReader(dir).read();
        assertEquals(10, s.periods());
        assertEquals(0, s.throttledPeriods());
        assertEquals(0, s.throttledUsec());
    }

    @Test
    void malformedRequiredNumberIsUnavailable() throws IOException {
        full();
        w("memory.current", "12x\n");
        assertNull(new CgroupReader(dir).read());
        w("memory.current", "");
        assertNull(new CgroupReader(dir).read());
    }

    @Test
    void malformedOptionalFilesReadAsZero() throws IOException {
        full();
        w("memory.max", "zzz");
        w("pids.current", "-3");
        w("memory.events", "oom x\noom_kill\n");
        var s = new CgroupReader(dir).read();
        assertEquals(0, s.memoryLimit());
        assertEquals(0, s.pidsCurrent());
        assertEquals(0, s.oom());
        assertEquals(0, s.oomKill());
    }

    @Test
    void absentOptionalFilesStillAvailable() throws IOException {
        w("cpu.stat", "nr_periods 1\n");
        w("memory.current", "5");
        var s = new CgroupReader(dir).read();
        assertNotNull(s);
        assertEquals(5, s.memoryCurrent());
        assertEquals(0, s.pidsCurrent());
    }

    @Test
    void cgroupV1LayoutIsUnavailable() throws IOException {
        Files.createDirectories(dir.resolve("cpu"));
        Files.createDirectories(dir.resolve("memory"));
        w("cpu/cpu.stat", "nr_periods 1\n");
        assertNull(new CgroupReader(dir).read());
    }

    @Test
    void oversizedFileIsReadBounded() throws IOException {
        full();
        w("cpu.stat", "nr_periods 3\n" + "x".repeat(100_000));
        assertEquals(3, new CgroupReader(dir).read().periods());
    }

    // ---- collector ----

    private record Harness(CgroupCollector c, List<Runnable> tasks, List<String> gauges, boolean[] cancelled) {}

    private Harness start() {
        var tasks = new ArrayList<Runnable>();
        var gauges = new ArrayList<String>();
        var cancelled = new boolean[1];
        Ledger ledger = (Ledger) Proxy.newProxyInstance(
                Ledger.class.getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
                    if (m.getName().startsWith("gauge")) {
                        gauges.add((String) a[0]);
                    }
                    return null;
                });
        HostScheduler sched = new HostScheduler() {
            @Override
            public Cancellable everyTicks(int ticks, Runnable r) {
                throw new AssertionError("main thread scheduling is forbidden");
            }

            @Override
            public Cancellable everyMillis(long ms, Runnable r) {
                assertEquals(15_000, ms);
                tasks.add(r);
                return () -> cancelled[0] = true;
            }
        };
        CollectorContext ctx = new CollectorContext() {
            public Ledger ledger() {
                return ledger;
            }

            public HostScheduler scheduler() {
                return sched;
            }

            public HostInfo host() {
                return null;
            }
        };
        var c = new CgroupCollector(dir);
        c.start(ctx);
        return new Harness(c, tasks, gauges, cancelled);
    }

    @Test
    void startRegistersFiveGaugesAndReadsOnlyInScheduledTask() throws IOException {
        full();
        var h = start();
        assertEquals(5, h.gauges().size());
        assertEquals(1, h.tasks().size());
        assertEquals(0, h.c().memoryBytes(), "no read happens in start()");
        h.tasks().get(0).run();
        assertEquals(123456, h.c().memoryBytes());
        assertEquals(2048, h.c().memoryLimitBytes());
        assertEquals(200, h.c().periodsTotal());
        assertEquals(50, h.c().throttledTotal());
        assertEquals(2.5, h.c().throttledSecondsTotal(), 1e-12);
    }

    @Test
    void counterResetKeepsExportedValueMonotonic() throws IOException {
        full();
        var h = start();
        h.tasks().get(0).run();
        w("cpu.stat", "nr_periods 20\nnr_throttled 5\nthrottled_usec 100000\n");
        h.tasks().get(0).run();
        assertEquals(220, h.c().periodsTotal());
        assertEquals(55, h.c().throttledTotal());
        assertEquals(2.6, h.c().throttledSecondsTotal(), 1e-9);
        w("cpu.stat", "nr_periods 30\nnr_throttled 6\nthrottled_usec 200000\n");
        h.tasks().get(0).run();
        assertEquals(230, h.c().periodsTotal());
        assertEquals(2.7, h.c().throttledSecondsTotal(), 1e-9);
    }

    @Test
    void equalReadingKeepsValue() throws IOException {
        full();
        var h = start();
        h.tasks().get(0).run();
        h.tasks().get(0).run();
        assertEquals(200, h.c().periodsTotal());
    }

    @Test
    void unavailableAtStartStopsAfterFiveConsecutiveFailuresAndCancels() {
        var h = start();
        for (int i = 1; i < CgroupCollector.MAX_FAILURES; i++) {
            h.tasks().get(0).run();
            assertFalse(h.c().isStopped(), "failure " + i);
            assertFalse(h.cancelled()[0]);
        }
        h.tasks().get(0).run();
        assertTrue(h.c().isStopped());
        assertTrue(h.cancelled()[0]);
        h.tasks().get(0).run();
        assertEquals(0, h.c().periodsTotal());
    }

    @Test
    void fileVanishingBetweenReadsStopsAndKeepsLastValues() throws IOException {
        full();
        var h = start();
        h.tasks().get(0).run();
        assertFalse(h.c().isStopped());
        Files.delete(dir.resolve("memory.current"));
        for (int i = 0; i < CgroupCollector.MAX_FAILURES; i++) {
            h.tasks().get(0).run();
        }
        assertTrue(h.c().isStopped());
        assertEquals(200, h.c().periodsTotal());
        w("memory.current", "9");
        h.tasks().get(0).run();
        assertEquals(123456, h.c().memoryBytes(), "stopped collector reads nothing more");
        h.c().stop();
    }

    @Test
    void oneFailedReadDoesNotStopAndASuccessResetsTheCount() throws IOException {
        full();
        var h = start();
        h.tasks().get(0).run();
        Path mem = dir.resolve("memory.current");
        Files.delete(mem);
        for (int round = 0; round < 3; round++) {
            for (int i = 0; i < CgroupCollector.MAX_FAILURES - 1; i++) {
                h.tasks().get(0).run();
                assertFalse(h.c().isStopped());
            }
            w("memory.current", "777");
            h.tasks().get(0).run();
            assertEquals(777, h.c().memoryBytes(), "recovered after a transient failure");
            Files.delete(mem);
        }
        assertFalse(h.c().isStopped());
        assertFalse(h.cancelled()[0]);
    }
}
