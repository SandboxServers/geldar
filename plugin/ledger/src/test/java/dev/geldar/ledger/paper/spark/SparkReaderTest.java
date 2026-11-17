package dev.geldar.ledger.paper.spark;

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
import java.io.InputStream;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.DoubleSupplier;
import me.lucko.spark.api.Spark;
import me.lucko.spark.api.SparkProvider;
import me.lucko.spark.api.statistic.StatisticWindow;
import me.lucko.spark.api.statistic.misc.DoubleAverageInfo;
import me.lucko.spark.api.statistic.types.DoubleStatistic;
import me.lucko.spark.api.statistic.types.GenericStatistic;
import org.junit.jupiter.api.Test;

class SparkReaderTest {
    final Map<String, DoubleSupplier> gauges = new LinkedHashMap<>();
    final List<Runnable> async = new ArrayList<>();
    boolean cancelled;

    /** A class loader that cannot see spark's API: the "spark is not installed" case. */
    static final class NoSpark extends ClassLoader {
        NoSpark() {
            super(SparkReaderTest.class.getClassLoader());
        }

        @Override
        protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
            if (name.startsWith("me.lucko.spark")) {
                throw new ClassNotFoundException(name);
            }
            return super.loadClass(name, resolve);
        }
    }

    Ledger ledger() {
        return (Ledger) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
            if (m.getName().equals("gaugeDouble")) {
                String[] pairs = (String[]) a[4];
                gauges.put(a[0] + String.join("|", pairs), (DoubleSupplier) a[3]);
            }
            return null;
        });
    }

    CollectorContext ctx(Ledger l) {
        HostScheduler s = new HostScheduler() {
            public Cancellable everyTicks(int ticks, Runnable r) {
                throw new AssertionError("main thread");
            }

            public Cancellable everyMillis(long ms, Runnable r) {
                assertEquals(15000, ms);
                async.add(r);
                return () -> cancelled = true;
            }
        };
        return new CollectorContext() {
            public Ledger ledger() {
                return l;
            }

            public HostScheduler scheduler() {
                return s;
            }

            public HostInfo host() {
                throw new AssertionError("unused");
            }
        };
    }

    @Test
    void classAbsentStartsEmitsNothingAndDoesNotThrow() {
        NoSpark loader = new NoSpark();
        SparkCollector c = new SparkCollector(new SparkReader(SparkReader.production(loader), System::nanoTime));
        c.start(ctx(ledger()));
        async.get(0).run();
        async.get(0).run();
        assertTrue(gauges.isEmpty());
        assertNull(SparkReader.production(loader).get(), "no spark on the loader: no adapter, so no spark class is loaded");
        assertNotNull(SparkReader.production(getClass().getClassLoader()).get());
        c.stop();
        assertTrue(cancelled);
    }

    final AtomicLong clock = new AtomicLong();

    SparkReader scripted(AtomicInteger mode) {
        return new SparkReader(
                () -> () -> {
                    if (mode.get() == 0) {
                        throw new IllegalStateException("gone");
                    }
                    return List.of(new SparkReader.Point("geldar_spark_mspt_ms", new String[] {"window", "1m", "stat", "mean"}, 40.0));
                },
                clock::get);
    }

    @Test
    void disableThenEnableRegistersTheGaugesOnTheNewLedger() {
        AtomicInteger mode = new AtomicInteger(1);
        SparkCollector c = new SparkCollector(scripted(mode));
        c.start(ctx(ledger()));
        async.get(0).run();
        assertEquals(1, gauges.size());
        c.stop();
        gauges.clear();
        c.start(ctx(ledger()));
        async.get(1).run();
        assertEquals(1, gauges.size(), "the new ledger got the gauge again");
        assertEquals(40.0, gauges.values().iterator().next().getAsDouble());
    }

    @Test
    void valuesGoNaNWhenSparkDisappearsAndComeBack() {
        AtomicInteger mode = new AtomicInteger(1);
        SparkCollector c = new SparkCollector(scripted(mode));
        c.start(ctx(ledger()));
        async.get(0).run();
        DoubleSupplier g = gauges.values().iterator().next();
        assertEquals(40.0, g.getAsDouble());
        mode.set(0);
        async.get(0).run();
        assertTrue(Double.isNaN(g.getAsDouble()));
        mode.set(1);
        clock.addAndGet(61_000_000_000L);
        async.get(0).run();
        assertEquals(40.0, g.getAsDouble());
        assertEquals(1, gauges.size());
    }

    @Test
    void notReadyProviderIsRetriedOnlyAfterSixtySeconds() {
        AtomicLong clock = new AtomicLong(1);
        AtomicInteger resolves = new AtomicInteger();
        SparkReader r = new SparkReader(
                () -> {
                    resolves.incrementAndGet();
                    return () -> {
                        throw new IllegalStateException("spark not loaded");
                    };
                },
                clock::get);
        assertTrue(r.poll().isEmpty());
        clock.addAndGet(59_000_000_000L);
        assertTrue(r.poll().isEmpty());
        assertEquals(1, resolves.get());
        clock.addAndGet(2_000_000_000L);
        assertTrue(r.poll().isEmpty());
        assertEquals(2, resolves.get());
    }

    @Test
    void gaugesShowSparkValuesFromTheRealAdapter() throws Exception {
        // SparkProvider.set is package-private in spark; install a fake Spark through reflection.
        var set = SparkProvider.class.getDeclaredMethod("set", Spark.class);
        set.setAccessible(true);
        set.invoke(null, fakeSpark());
        try {
            SparkCollector c = new SparkCollector(new SparkReader(SparkReader.production(getClass().getClassLoader()), System::nanoTime));
            c.start(ctx(ledger()));
            assertTrue(gauges.isEmpty(), "nothing is registered before the first async read");
            async.get(0).run();
            assertEquals(19.5, gauges.get("geldar_spark_tpswindow|1m").getAsDouble());
            assertEquals(0.25, gauges.get("geldar_spark_cpu_ratioscope|process|window|10s").getAsDouble());
            assertEquals(0.5, gauges.get("geldar_spark_cpu_ratioscope|system|window|10s").getAsDouble());
            assertEquals(40.0, gauges.get("geldar_spark_mspt_mswindow|1m|stat|mean").getAsDouble());
            assertEquals(48.0, gauges.get("geldar_spark_mspt_mswindow|1m|stat|max").getAsDouble());
            assertEquals(12.0, gauges.get("geldar_spark_gc_msgc|G1 Young|window|lifetime").getAsDouble());
        } finally {
            set.invoke(null, (Object) null);
        }
    }

    @Test
    void sparkClassesNeverAppearInTheReaderOrCollector() throws Exception {
        for (String n : List.of("SparkReader", "SparkCollector")) {
            assertFalse(bytes(n).contains("me/lucko"), n + " must not name a spark class");
        }
        assertFalse(bytes("SparkCollector").contains("SparkApiAdapter"));
    }

    @Test
    void noProfilerHeapOrHealthReportCallsAnywhere() throws Exception {
        for (String n : List.of("SparkReader", "SparkCollector", "SparkApiAdapter")) {
            String b = bytes(n).toLowerCase();
            assertFalse(b.contains("profiler"), n);
            assertFalse(b.contains("heap"), n);
            assertFalse(b.contains("healthreport"), n);
        }
    }

    String bytes(String simple) throws Exception {
        try (InputStream in = SparkReader.class.getResourceAsStream(simple + ".class")) {
            assertNotNull(in);
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.ISO_8859_1);
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static Spark fakeSpark() {
        return (Spark) Proxy.newProxyInstance(SparkReaderTest.class.getClassLoader(), new Class<?>[] {Spark.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "tps":
                    return dbl(StatisticWindow.TicksPerSecond.MINUTES_1, 19.5);
                case "cpuProcess":
                    return dbl(StatisticWindow.CpuUsage.SECONDS_10, 0.25);
                case "cpuSystem":
                    return dbl(StatisticWindow.CpuUsage.SECONDS_10, 0.5);
                case "mspt":
                    return gen();
                case "gc":
                    return Map.of("G1 Young", Proxy.newProxyInstance(
                            SparkReaderTest.class.getClassLoader(),
                            new Class<?>[] {me.lucko.spark.api.gc.GarbageCollector.class},
                            (p2, m2, a2) -> m2.getName().equals("avgTime") ? 12.0 : null));
                default:
                    return null;
            }
        });
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static DoubleStatistic dbl(Enum window, double v) {
        return (DoubleStatistic) Proxy.newProxyInstance(
                SparkReaderTest.class.getClassLoader(), new Class<?>[] {DoubleStatistic.class}, (p, m, a) -> {
                    if (m.getName().equals("getWindows")) {
                        Object arr = java.lang.reflect.Array.newInstance(window.getDeclaringClass(), 1);
                        java.lang.reflect.Array.set(arr, 0, window);
                        return arr;
                    }
                    return m.getName().equals("poll") ? v : null;
                });
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static GenericStatistic gen() {
        Enum window = StatisticWindow.MillisPerTick.MINUTES_1;
        DoubleAverageInfo info = (DoubleAverageInfo) Proxy.newProxyInstance(
                SparkReaderTest.class.getClassLoader(), new Class<?>[] {DoubleAverageInfo.class}, (p, m, a) -> switch (m.getName()) {
                    case "mean" -> 40.0;
                    case "max" -> 48.0;
                    case "percentile95th" -> 45.0;
                    default -> 0.0;
                });
        return (GenericStatistic) Proxy.newProxyInstance(
                SparkReaderTest.class.getClassLoader(), new Class<?>[] {GenericStatistic.class}, (p, m, a) -> {
                    if (m.getName().equals("getWindows")) {
                        Object arr = java.lang.reflect.Array.newInstance(window.getDeclaringClass(), 1);
                        java.lang.reflect.Array.set(arr, 0, window);
                        return arr;
                    }
                    return m.getName().equals("poll") ? info : null;
                });
    }
}
