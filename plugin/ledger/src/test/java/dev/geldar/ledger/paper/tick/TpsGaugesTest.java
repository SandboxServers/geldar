package dev.geldar.ledger.paper.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.DoubleSupplier;
import org.junit.jupiter.api.Test;

class TpsGaugesTest {
    final Map<String, DoubleSupplier> gauges = new LinkedHashMap<>();
    final List<Runnable> async = new ArrayList<>();
    boolean cancelled;
    int sourceCalls;
    double[] value = {19.5, 18.0, 17.0};

    TpsGauges started() {
        Ledger l = (Ledger) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
                    if (m.getName().equals("gaugeDouble")) {
                        String[] pairs = (String[]) a[4];
                        assertEquals("window", pairs[0]);
                        gauges.put(pairs[1], (DoubleSupplier) a[3]);
                    }
                    return null;
                });
        HostScheduler s = new HostScheduler() {
            public Cancellable everyTicks(int ticks, Runnable r) {
                throw new AssertionError("main thread");
            }

            public Cancellable everyMillis(long ms, Runnable r) {
                assertEquals(5000, ms);
                async.add(r);
                return () -> cancelled = true;
            }
        };
        TpsGauges g = new TpsGauges(() -> {
            sourceCalls++;
            return value;
        });
        g.start(l, s);
        return g;
    }

    @Test
    void readersReturnCachedValuesAndNeverCallTheSource() {
        TpsGauges g = started();
        assertEquals(List.of("1m", "5m", "15m"), List.copyOf(gauges.keySet()));
        assertEquals(0, sourceCalls);
        assertEquals(0.0, gauges.get("1m").getAsDouble());
        async.get(0).run();
        assertEquals(1, sourceCalls);
        for (int i = 0; i < 5; i++) {
            gauges.get("1m").getAsDouble();
            gauges.get("15m").getAsDouble();
        }
        assertEquals(1, sourceCalls);
        assertEquals(19.5, gauges.get("1m").getAsDouble());
        assertEquals(18.0, gauges.get("5m").getAsDouble());
        assertEquals(17.0, gauges.get("15m").getAsDouble());
        assertNotNull(g);
    }

    @Test
    void failedOrShortReadKeepsPreviousValues() {
        started();
        async.get(0).run();
        value = new double[] {1};
        async.get(0).run();
        assertEquals(19.5, gauges.get("1m").getAsDouble());
        value = null;
        async.get(0).run();
        assertEquals(19.5, gauges.get("1m").getAsDouble());
    }

    @Test
    void throwingSourceNeverEscapes() {
        Ledger l = (Ledger) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> null);
        List<Runnable> tasks = new ArrayList<>();
        TpsGauges g = new TpsGauges(() -> {
            throw new IllegalStateException("x");
        });
        g.start(l, new HostScheduler() {
            public Cancellable everyTicks(int t, Runnable r) {
                return null;
            }

            public Cancellable everyMillis(long ms, Runnable r) {
                tasks.add(r);
                return () -> {};
            }
        });
        tasks.get(0).run();
        assertTrue(tasks.size() == 1);
    }

    @Test
    void stopCancelsTheTaskAndIsIdempotent() {
        TpsGauges g = started();
        g.stop();
        assertTrue(cancelled);
        g.stop();
    }
}
