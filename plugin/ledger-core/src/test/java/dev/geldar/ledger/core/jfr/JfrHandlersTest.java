package dev.geldar.ledger.core.jfr;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class JfrHandlersTest {
    /** Names the agent's {@code jvm.*} metrics own (OTel semantic conventions for JVM runtime metrics). */
    private static final Set<String> AGENT_NAMES = Set.of(
            "jvm.memory.used",
            "jvm.memory.committed",
            "jvm.memory.limit",
            "jvm.memory.used_after_last_gc",
            "jvm.gc.duration",
            "jvm.thread.count",
            "jvm.class.loaded",
            "jvm.class.unloaded",
            "jvm.class.count",
            "jvm.cpu.time",
            "jvm.cpu.count",
            "jvm.cpu.recent_utilization",
            "jvm.buffer.memory.usage",
            "jvm.buffer.count");

    private static final Set<String> NEVER = Set.of(
            "jdk.ExecutionSample",
            "jdk.CPUTimeSample",
            "jdk.MethodTiming",
            "jdk.MethodTrace",
            "jdk.JavaExceptionThrow");

    /** An accessor over a fixed map that records every field name asked for, and fails on a missing field. */
    private static final class Fake implements Function<String, Object> {
        final Map<String, Object> values = new HashMap<>();
        final List<String> reads = new ArrayList<>();

        Fake with(String k, Object v) {
            values.put(k, v);
            return this;
        }

        @Override
        public Object apply(String k) {
            reads.add(k);
            return values.get(k);
        }
    }

    private static Fake cpu(Instant t, String thread, double user, double system) {
        return new Fake()
                .with("startTime", t)
                .with("user", (float) user)
                .with("system", (float) system)
                .with("eventThread.javaName", thread);
    }

    @Test
    void threadNamesMapToFixedGroups() {
        Map<String, String> table = Map.ofEntries(
                Map.entry("Server thread", "server"),
                Map.entry("Paper Async Task Handler Thread - 0", "io"),
                Map.entry("Netty Epoll Server IO #0", "io"),
                Map.entry("ledger-jfr", "ledger"),
                Map.entry("ledger-export", "ledger"),
                Map.entry("C2 CompilerThread0", "jit"),
                Map.entry("C1 CompilerThread1", "jit"),
                Map.entry("G1 Conc#0", "gc"),
                Map.entry("GC Thread#2", "gc"),
                Map.entry("Worker-Main-3", "other"),
                Map.entry("", "other"));
        table.forEach((name, group) -> assertEquals(group, ThreadCpuHandler.groupOf(name), name));
        assertEquals("other", ThreadCpuHandler.groupOf(null));
    }

    @Test
    void ratioIsUserPlusSystemSummedPerGroupAndPublishedWhenThePeriodEnds() {
        RecordingLedger ledger = new RecordingLedger();
        ThreadCpuHandler h = new ThreadCpuHandler(ledger);
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
        h.handle("jdk.ThreadCPULoad", cpu(t0, "Server thread", 0.25, 0.125));
        h.handle("jdk.ThreadCPULoad", cpu(t0, "C2 CompilerThread0", 0.5, 0.0));
        h.handle("jdk.ThreadCPULoad", cpu(t0, "C1 CompilerThread0", 0.0, 0.25));
        assertEquals(0.0, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "server"), "not published yet");
        h.handle("jdk.ThreadCPULoad", cpu(t0.plusSeconds(10), "Server thread", 0.5, 0.0));
        assertEquals(0.375, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "server"), 1e-9);
        assertEquals(0.75, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "jit"), 1e-9);
        assertEquals(0.0, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "ledger"), 1e-9);
    }

    @Test
    void theGaugeKeepsTheLastPeriodWhenEventsStopAndReadsZeroUntilTheSecondPeriod() {
        RecordingLedger ledger = new RecordingLedger();
        ThreadCpuHandler h = new ThreadCpuHandler(ledger);
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
        h.handle("jdk.ThreadCPULoad", cpu(t0, "Server thread", 0.25, 0.25));
        assertEquals(0.0, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "server"), "first period is not visible yet");
        h.handle("jdk.ThreadCPULoad", cpu(t0.plusSeconds(10), "Server thread", 0.0, 0.0));
        assertEquals(0.5, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "server"), 1e-9);
        // no more events: the value stays at the last completed period
        assertEquals(0.5, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "server"), 1e-9);
    }

    @Test
    void ledgerOwnThreadsGoToGroupLedger() {
        RecordingLedger ledger = new RecordingLedger();
        ThreadCpuHandler h = new ThreadCpuHandler(ledger);
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");
        h.handle("jdk.ThreadCPULoad", cpu(t0, "ledger-jfr", 0.125, 0.125));
        h.handle("jdk.ThreadCPULoad", cpu(t0.plusSeconds(10), "Server thread", 0.0, 0.0));
        assertEquals(0.25, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "ledger"), 1e-9);
        assertEquals(0.0, ledger.readGaugeDouble(Names.Jfr.THREAD_GROUP_CPU_RATIO, "other"), 1e-9);
    }

    @Test
    void safepointDurationsGoToOneHistogramInMilliseconds() {
        RecordingLedger ledger = new RecordingLedger();
        SafepointHandler h = new SafepointHandler(ledger);
        h.handle("jdk.SafepointBegin", new Fake().with("duration", Duration.ofMillis(12)));
        h.handle("jdk.SafepointEnd", new Fake().with("duration", Duration.ofMillis(40)));
        h.handle("jdk.GarbageCollection", new Fake().with("duration", Duration.ofMillis(99)));
        assertEquals(List.of(12.0, 40.0), ledger.histogramValues(Names.Jfr.SAFEPOINT_MS));
    }

    @Test
    void contentionCountsByFirstTwoPackageSegments() {
        assertEquals("java.util", ContentionHandler.groupOf("java.util.concurrent.ConcurrentHashMap"));
        assertEquals("org.bukkit", ContentionHandler.groupOf("org.bukkit.craftbukkit.CraftServer"));
        assertEquals("java", ContentionHandler.groupOf("java.Thing"));
        assertEquals("default", ContentionHandler.groupOf("Thing"));
        assertEquals("java.util", ContentionHandler.groupOf("[Ljava.util.Foo;"));
        assertEquals("other", ContentionHandler.groupOf(null));
        // the shape a real JVM returns for monitorClass.name (JFR probe, JDK 25)
        assertEquals("java.util", ContentionHandler.groupOf("java/util/ArrayList"));
        assertEquals("java.util", ContentionHandler.groupOf("java/util/ArrayList$Itr"));
        assertEquals("org.bukkit", ContentionHandler.groupOf("org/bukkit/craftbukkit/CraftServer"));
        assertEquals("default", ContentionHandler.groupOf("Thing$Inner"));
        assertEquals("java.util", ContentionHandler.groupOf("[Ljava/util/Foo;"));
        RecordingLedger ledger = new RecordingLedger();
        ContentionHandler h = new ContentionHandler(ledger);
        h.handle("jdk.JavaMonitorEnter", new Fake().with("monitorClass.name", "java.util.Vector"));
        h.handle("jdk.JavaMonitorEnter", new Fake().with("monitorClass.name", "java.util.Hashtable"));
        h.handle("jdk.JavaMonitorEnter", new Fake().with("monitorClass.name", "net.minecraft.Foo"));
        h.handle("jdk.JavaMonitorEnter", new Fake());
        assertEquals(2, ledger.counterValue(Names.Jfr.MONITOR_CONTENTION_TOTAL, "java.util"));
        assertEquals(1, ledger.counterValue(Names.Jfr.MONITOR_CONTENTION_TOTAL, "net.minecraft"));
        assertEquals(1, ledger.counterValue(Names.Jfr.MONITOR_CONTENTION_TOTAL, "other"));
    }

    @Test
    void contentionGroupsAreBounded() {
        RecordingLedger ledger = new RecordingLedger();
        ContentionHandler h = new ContentionHandler(ledger);
        for (int i = 0; i < ContentionHandler.MAX_GROUPS + 20; i++) {
            h.handle("jdk.JavaMonitorEnter", new Fake().with("monitorClass.name", "p" + i + ".q.C"));
        }
        long seen = 0;
        for (int i = 0; i < ContentionHandler.MAX_GROUPS + 20; i++) {
            seen += ledger.counterValue(Names.Jfr.MONITOR_CONTENTION_TOTAL, "p" + i + ".q") > 0 ? 1 : 0;
        }
        assertTrue(seen <= ContentionHandler.MAX_GROUPS + 1, "bound groups: " + seen);
        assertEquals(
                ContentionHandler.MAX_GROUPS + 20,
                seen + ledger.counterValue(Names.Jfr.MONITOR_CONTENTION_TOTAL, "other") - 0,
                "every event is counted somewhere");
    }

    @Test
    void fileIoSplitsReadAndWriteAndNeverReadsThePath() {
        RecordingLedger ledger = new RecordingLedger();
        FileIoHandler h = new FileIoHandler(ledger);
        Fake read = new Fake().with("duration", Duration.ofMillis(15)).with("path", "world/region/r.0.0.mca");
        h.handle("jdk.FileRead", read);
        h.handle("jdk.FileWrite", new Fake().with("duration", Duration.ofMillis(30)));
        assertEquals(List.of(15.0), ledger.histogramValues(Names.Jfr.FILE_IO_MS, "read"));
        assertEquals(List.of(30.0), ledger.histogramValues(Names.Jfr.FILE_IO_MS, "write"));
        assertFalse(read.reads.contains("path"));
    }

    @Test
    void exceptionStatisticsBecomeADeltaWithTheFirstSampleAsBaseline() {
        RecordingLedger ledger = new RecordingLedger();
        ExceptionHandler h = new ExceptionHandler(ledger);
        h.handle("jdk.ExceptionStatistics", new Fake().with("throwables", 1000L));
        assertEquals(0, ledger.counterValue(Names.Jfr.EXCEPTIONS_TOTAL, "thrown"));
        h.handle("jdk.ExceptionStatistics", new Fake().with("throwables", 1007L));
        h.handle("jdk.ExceptionStatistics", new Fake().with("throwables", 1010L));
        assertEquals(10, ledger.counterValue(Names.Jfr.EXCEPTIONS_TOTAL, "thrown"));
        h.handle("jdk.ExceptionStatistics", new Fake().with("throwables", 5L));
        h.handle("jdk.ExceptionStatistics", new Fake().with("throwables", 6L));
        assertEquals(11, ledger.counterValue(Names.Jfr.EXCEPTIONS_TOTAL, "thrown"), "re-baselined after a drop");
    }

    @Test
    void handlersReadOnlyTheirAllowListedFieldsNeverForbiddenOnes() {
        Instant t = Instant.parse("2026-01-01T00:00:00Z");
        RecordingLedger ledger = new RecordingLedger();
        record Case(String event, Set<String> allowed, Fake fake, Runnable run) {}
        ThreadCpuHandler cpuH = new ThreadCpuHandler(ledger);
        SafepointHandler spH = new SafepointHandler(ledger);
        ContentionHandler ctH = new ContentionHandler(ledger);
        FileIoHandler ioH = new FileIoHandler(ledger);
        ExceptionHandler exH = new ExceptionHandler(ledger);
        Fake f1 = cpu(t, "Server thread", 0.1, 0.1);
        Fake f2 = new Fake().with("duration", Duration.ofMillis(11));
        Fake f3 = new Fake().with("monitorClass.name", "a.b.C");
        Fake f4 = new Fake().with("duration", Duration.ofMillis(11));
        Fake f5 = new Fake().with("duration", Duration.ofMillis(11));
        Fake f6 = new Fake().with("throwables", 3L);
        List<Case> cases = List.of(
                new Case("jdk.ThreadCPULoad", ThreadCpuHandler.FIELDS, f1, () -> cpuH.handle("jdk.ThreadCPULoad", f1)),
                new Case("jdk.SafepointBegin", SafepointHandler.FIELDS, f2, () -> spH.handle("jdk.SafepointBegin", f2)),
                new Case("jdk.JavaMonitorEnter", ContentionHandler.FIELDS, f3, () -> ctH.handle("jdk.JavaMonitorEnter", f3)),
                new Case("jdk.FileRead", FileIoHandler.FIELDS, f4, () -> ioH.handle("jdk.FileRead", f4)),
                new Case("jdk.FileWrite", FileIoHandler.FIELDS, f5, () -> ioH.handle("jdk.FileWrite", f5)),
                new Case("jdk.ExceptionStatistics", ExceptionHandler.FIELDS, f6, () -> exH.handle("jdk.ExceptionStatistics", f6)));
        for (Case c : cases) {
            c.run().run();
            assertFalse(c.fake().reads.isEmpty(), c.event());
            for (String read : c.fake().reads) {
                assertTrue(c.allowed().contains(read), c.event() + " read " + read);
                assertFalse(JfrHandler.forbiddenFields().contains(read), c.event() + " read forbidden " + read);
            }
            for (String allowed : c.allowed()) {
                assertFalse(JfrHandler.forbiddenFields().contains(allowed), allowed);
                assertFalse(allowed.contains("stackTrace") || allowed.contains("path"), allowed);
            }
        }
    }

    @Test
    void metricNamesAndAttributesAreBareAndNotTheAgents() {
        RecordingLedger ledger = new RecordingLedger();
        new ThreadCpuHandler(ledger);
        new SafepointHandler(ledger);
        new ContentionHandler(ledger);
        new FileIoHandler(ledger);
        new ExceptionHandler(ledger);
        List<String> names = List.of(
                Names.Jfr.THREAD_GROUP_CPU_RATIO,
                Names.Jfr.SAFEPOINT_MS,
                Names.Jfr.MONITOR_CONTENTION_TOTAL,
                Names.Jfr.FILE_IO_MS,
                Names.Jfr.EXCEPTIONS_TOTAL);
        for (String n : names) {
            assertTrue(n.startsWith("geldar_jfr_"), n);
            assertFalse(n.startsWith("jvm_") || n.startsWith("jvm."), n);
            assertFalse(AGENT_NAMES.contains(n), n);
            assertFalse(ledger.registrations(n).isEmpty(), n + " registered");
        }
        assertEquals(List.of(), ledger.rejectedMetricKeys());
    }

    @Test
    void handlersNeverRequestDeniedOrProfilingEvents() {
        RecordingLedger ledger = new RecordingLedger();
        List<JfrHandler> all = List.of(
                new ThreadCpuHandler(ledger),
                new SafepointHandler(ledger),
                new ContentionHandler(ledger),
                new FileIoHandler(ledger),
                new ExceptionHandler(ledger));
        Set<String> requested = new java.util.TreeSet<>();
        all.forEach(h -> requested.addAll(h.eventNames()));
        for (String e : requested) {
            assertFalse(NEVER.contains(e), e);
            assertFalse(JfrSettings.DENIED.contains(e), e);
            assertFalse(e.startsWith("jdk.GC") || e.contains("Heap") || e.contains("Allocation"), e);
        }
        assertTrue(JfrSettings.defaults().allowed().containsAll(requested), "every requested event has a setting");
        assertEquals(
                Set.of(
                        "jdk.ThreadCPULoad",
                        "jdk.SafepointBegin",
                        "jdk.SafepointEnd",
                        "jdk.JavaMonitorEnter",
                        "jdk.FileRead",
                        "jdk.FileWrite",
                        "jdk.ExceptionStatistics"),
                requested);
    }
}
