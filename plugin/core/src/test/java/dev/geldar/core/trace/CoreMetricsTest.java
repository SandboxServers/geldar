package dev.geldar.core.trace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.opentelemetry.api.metrics.LongCounterBuilder;
import io.opentelemetry.api.metrics.Meter;
import io.opentelemetry.api.metrics.MeterProvider;
import io.opentelemetry.api.metrics.ObservableLongMeasurement;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CoreMetricsTest {
    // Same pattern as NameRules.isMetricName in ledger-core (not a dependency of core).
    private static final Pattern METRIC = Pattern.compile("^geldar_[a-z0-9_]+$");
    private static final List<String> NAMES = List.of(
            CoreMetrics.PUBLISHER_PUBLISHED, CoreMetrics.PUBLISHER_FAILED, CoreMetrics.PUBLISHER_DROPPED,
            CoreMetrics.HEARING_SENT, CoreMetrics.HEARING_DROPPED, CoreMetrics.BLOCKOWNER_QUERIES,
            CoreMetrics.BLOCKOWNER_CACHE_HITS, CoreMetrics.BLOCKOWNER_FAILURES, CoreMetrics.KINO_PUBLISHED,
            CoreMetrics.KINO_DROPPED);

    @BeforeEach
    void reset() {
        CoreMetrics.resetForTest();
    }

    @Test
    void namesMatchTheMetricPatternAndFamilies() {
        for (String name : NAMES) {
            assertTrue(METRIC.matcher(name).matches(), name);
            assertTrue(name.matches("geldar_(publisher|hearing|blockowner|kino)_.*"), name);
        }
    }

    @Test
    void registerWithNoopApiAndNullSinksDoesNotThrowAndRunsOnce() {
        assertTrue(CoreMetrics.register(null, null, null, null));
        assertFalse(CoreMetrics.register(null, null, null, null));
    }

    @Test
    void registerOnCreatesOneInstrumentPerSource() {
        List<String> created = new ArrayList<>();
        Meter noop = MeterProvider.noop().get("t");
        Meter spy = (Meter) Proxy.newProxyInstance(
                Meter.class.getClassLoader(), new Class<?>[] {Meter.class}, (p, method, args) -> {
                    if (method.getName().equals("counterBuilder")) {
                        created.add((String) args[0]);
                    }
                    return method.invoke(noop, args);
                });
        Map<String, LongSupplier> sources = new LinkedHashMap<>();
        for (String n : NAMES) {
            sources.put(n, () -> 1L);
        }
        CoreMetrics.registerOn(spy, sources);
        assertEquals(NAMES, created);
    }

    @Test
    void observedValuesCarryNoAttributes() {
        List<String> calls = new ArrayList<>();
        long[] seen = new long[1];
        Meter meter = (Meter) Proxy.newProxyInstance(
                Meter.class.getClassLoader(), new Class<?>[] {Meter.class}, (p, method, args) -> {
                    Object builder = Proxy.newProxyInstance(
                            Meter.class.getClassLoader(), new Class<?>[] {LongCounterBuilder.class}, (bp, bm, bargs) -> {
                                if (bm.getName().equals("buildWithCallback")) {
                                    @SuppressWarnings("unchecked")
                                    Consumer<ObservableLongMeasurement> cb = (Consumer<ObservableLongMeasurement>) bargs[0];
                                    cb.accept((ObservableLongMeasurement) Proxy.newProxyInstance(
                                            Meter.class.getClassLoader(), new Class<?>[] {ObservableLongMeasurement.class},
                                            (mp, mm, margs) -> {
                                                calls.add(mm.getName() + "/" + margs.length);
                                                seen[0] = (Long) margs[0];
                                                return null;
                                            }));
                                    return null;
                                }
                                return bp;
                            });
                    return builder;
                });
        CoreMetrics.registerOn(meter, Map.of(CoreMetrics.KINO_DROPPED, () -> 7L));
        assertEquals(List.of("record/1"), calls);
        assertEquals(7L, seen[0]);
    }

    @Test
    void queueDepthIsAnAttributeFreeGaugeNotACounter() {
        List<String> gauges = new ArrayList<>();
        List<String> counters = new ArrayList<>();
        Meter noop = MeterProvider.noop().get("t");
        Meter spy = (Meter) Proxy.newProxyInstance(
                Meter.class.getClassLoader(), new Class<?>[] {Meter.class}, (p, method, args) -> {
                    if (method.getName().equals("gaugeBuilder")) {
                        gauges.add((String) args[0]);
                    } else if (method.getName().equals("counterBuilder")) {
                        counters.add((String) args[0]);
                    }
                    return method.invoke(noop, args);
                });
        CoreMetrics.registerGaugesOn(spy, Map.of(CoreMetrics.PUBLISHER_QUEUE_DEPTH, () -> 3L));
        assertEquals(List.of("geldar_publisher_queue_depth"), gauges);
        assertTrue(counters.isEmpty());
        assertTrue(CoreMetrics.PUBLISHER_QUEUE_DEPTH.matches("geldar_publisher_.*"));
    }
}
