package dev.geldar.core.trace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.NatsEventPublisher;
import dev.geldar.core.blockowner.OwnerQueryService;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import dev.geldar.core.kino.NatsKinoSink;
import dev.geldar.core.proximity.NatsHearingSink;
import io.opentelemetry.api.metrics.Meter;
import io.opentelemetry.api.metrics.ObservableLongMeasurement;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.logging.Logger;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class CoreMetricsTest {
    // Same pattern as NameRules.isMetricName in ledger-core (not a dependency of core).
    private static final Pattern METRIC = Pattern.compile("^geldar_[a-z0-9_]+$");
    private static final List<String> NAMES = List.of(
            CoreMetrics.PUBLISHER_PUBLISHED, CoreMetrics.PUBLISHER_FAILED, CoreMetrics.PUBLISHER_DROPPED,
            CoreMetrics.PUBLISHER_QUEUE_DEPTH, CoreMetrics.HEARING_SENT, CoreMetrics.HEARING_DROPPED,
            CoreMetrics.BLOCKOWNER_QUERIES, CoreMetrics.BLOCKOWNER_CACHE_HITS, CoreMetrics.BLOCKOWNER_FAILURES,
            CoreMetrics.KINO_PUBLISHED, CoreMetrics.KINO_DROPPED);

    /** A meter that remembers each instrument's callback, how it was built and how often it was closed. */
    private static final class Recorder {
        final Map<String, Consumer<ObservableLongMeasurement>> callbacks = new LinkedHashMap<>();
        final List<String> kinds = new ArrayList<>();
        final List<String> closed = new ArrayList<>();
        final Meter meter = (Meter) Proxy.newProxyInstance(
                Meter.class.getClassLoader(), new Class<?>[] {Meter.class}, (p, method, args) -> {
                    String kind = method.getName().equals("gaugeBuilder") ? "gauge" : "counter";
                    return builder(method.getReturnType(), (String) args[0], kind);
                });

        private Object builder(Class<?> type, String name, String kind) {
            return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (p, method, args) -> {
                if (method.getName().equals("buildWithCallback")) {
                    @SuppressWarnings("unchecked")
                    Consumer<ObservableLongMeasurement> cb = (Consumer<ObservableLongMeasurement>) args[0];
                    callbacks.put(name, cb);
                    kinds.add(kind + ":" + name);
                    return Proxy.newProxyInstance(method.getReturnType().getClassLoader(),
                            new Class<?>[] {method.getReturnType()}, (q, m, a) -> {
                                if (m.getName().equals("close")) {
                                    closed.add(name);
                                }
                                return null;
                            });
                }
                if (method.getName().equals("ofLongs")) {
                    return builder(method.getReturnType(), name, kind);
                }
                return p;
            });
        }

        /** Runs the callback once; returns the value recorded and the number of arguments it was given. */
        long[] read(String name) {
            long[] seen = {-1, -1};
            callbacks.get(name).accept((ObservableLongMeasurement) Proxy.newProxyInstance(
                    Meter.class.getClassLoader(), new Class<?>[] {ObservableLongMeasurement.class}, (p, m, a) -> {
                        if (m.getName().equals("record")) {
                            seen[0] = (Long) a[0];
                            seen[1] = a.length;
                        }
                        return null;
                    }));
            return seen;
        }
    }

    private static final String LIFE = "ag_kestrel_01";

    @Test
    void namesMatchTheMetricPatternAndFamilies() {
        for (String name : NAMES) {
            assertTrue(METRIC.matcher(name).matches(), name);
            assertTrue(name.matches("geldar_(publisher|hearing|blockowner|kino)_.*"), name);
        }
    }

    @Test
    void registerWithNoopApiAndNullSourcesDoesNotThrow() {
        CoreMetrics.Registration r = CoreMetrics.register(null, null, null, null);
        assertNotNull(r);
        r.close();
    }

    @Test
    void everyAccessorIsMappedToItsOwnName() throws Exception {
        ExecutorService lookups = Executors.newSingleThreadExecutor();
        NatsEventPublisher publisher = new NatsEventPublisher("nats://127.0.0.1:1", 10, Logger.getAnonymousLogger());
        NatsHearingSink hearing = new NatsHearingSink("nats://127.0.0.1:1", "s", k -> null, Logger.getAnonymousLogger());
        NatsKinoSink kino = new NatsKinoSink("nats://127.0.0.1:1", "s", k -> null, Logger.getAnonymousLogger());
        OwnerQueryService owners = new OwnerQueryService(
                (w, x, z) -> new Owners(List.of(), false),
                new dev.geldar.core.blockowner.OwnerCache(System::currentTimeMillis), lookups, 1_000,
                Logger.getAnonymousLogger());
        try {
            // No connection yet: one hearing notice and two Kino messages are dropped, none sent or published.
            hearing.muffled(LIFE, "n", "near");
            kino.publish("ag_a", "{}");
            kino.publish("ag_a", "{}");
            owners.answer("w", 0, 0).get(5, TimeUnit.SECONDS);
            owners.answer("w", 0, 0).get(5, TimeUnit.SECONDS);
            Recorder rec = new Recorder();

            CoreMetrics.register(rec.meter, publisher, hearing, kino, owners);

            assertEquals(NAMES.size(), rec.callbacks.size());
            assertEquals(List.of(NAMES.get(3)), rec.kinds.stream().filter(k -> k.startsWith("gauge:"))
                    .map(k -> k.substring(6)).toList(), "only the queue depth is a gauge");
            Map<String, Long> expected = Map.of(
                    CoreMetrics.PUBLISHER_PUBLISHED, 0L, CoreMetrics.PUBLISHER_FAILED, 0L,
                    CoreMetrics.PUBLISHER_DROPPED, 0L, CoreMetrics.HEARING_SENT, 0L, CoreMetrics.HEARING_DROPPED, 1L,
                    CoreMetrics.BLOCKOWNER_QUERIES, 2L, CoreMetrics.BLOCKOWNER_CACHE_HITS, 1L,
                    CoreMetrics.BLOCKOWNER_FAILURES, 0L, CoreMetrics.KINO_PUBLISHED, 0L);
            expected.forEach((name, value) -> assertEquals(value, rec.read(name)[0], name));
            assertEquals(2L, rec.read(CoreMetrics.KINO_DROPPED)[0]);
            for (String name : NAMES) {
                assertEquals(1, rec.read(name)[1], name + " is recorded with no attributes");
            }
        } finally {
            lookups.shutdownNow();
            publisher.close();
            hearing.close();
            kino.close();
        }
    }

    @Test
    void registrationsAreFreshAfterADisableAndEnableCycle() {
        Recorder first = new Recorder();
        CoreMetrics.Registration one = CoreMetrics.register(first.meter, null, null, new NatsKinoSink(
                "nats://127.0.0.1:1", "s", k -> null, Logger.getAnonymousLogger()), null);
        assertEquals(2, first.callbacks.size());
        assertTrue(first.closed.isEmpty());
        one.close();
        assertEquals(List.of(CoreMetrics.KINO_PUBLISHED, CoreMetrics.KINO_DROPPED), first.closed);
        one.close();
        assertEquals(2, first.closed.size(), "closing twice closes nothing again");

        Recorder second = new Recorder();
        NatsKinoSink next = new NatsKinoSink("nats://127.0.0.1:1", "s", k -> null, Logger.getAnonymousLogger());
        CoreMetrics.register(second.meter, null, null, next, null);
        next.publish("ag_a", "{}");
        assertEquals(2, second.callbacks.size(), "the second enable registers again");
        assertEquals(1L, second.read(CoreMetrics.KINO_DROPPED)[0], "and reads the new sink");
    }

    @Test
    void noInstrumentIsMadeForANullSource() {
        Recorder rec = new Recorder();
        CoreMetrics.register(rec.meter, null, null, null, null);
        assertTrue(rec.callbacks.isEmpty());
        assertNull(rec.callbacks.get(CoreMetrics.KINO_DROPPED));
    }

    @Test
    void registerOnCreatesOneCounterPerSource() {
        Recorder rec = new Recorder();
        Map<String, LongSupplier> sources = new LinkedHashMap<>();
        sources.put(CoreMetrics.KINO_DROPPED, () -> 7L);
        CoreMetrics.registerOn(rec.meter, sources);
        assertEquals(7L, rec.read(CoreMetrics.KINO_DROPPED)[0]);
        assertEquals(1, rec.read(CoreMetrics.KINO_DROPPED)[1]);
    }
}
