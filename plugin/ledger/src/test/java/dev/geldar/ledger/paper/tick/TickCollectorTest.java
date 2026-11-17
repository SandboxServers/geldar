package dev.geldar.ledger.paper.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.Counter;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;
import org.bukkit.ServerTickManager;
import org.junit.jupiter.api.Test;

class TickCollectorTest {
    final AtomicLong clock = new AtomicLong();
    final List<Map<String, Object>> stallEvents = new ArrayList<>();
    final List<Runnable> async = new ArrayList<>();
    final List<Runnable> main = new ArrayList<>();
    final Map<String, LongSupplier> longGauges = new HashMap<>();
    final Map<String, DoubleSupplier> doubleGauges = new HashMap<>();
    final List<String> counterAdds = new ArrayList<>();
    final List<Object> registered = new ArrayList<>();
    int cancels;
    int setterCalls;
    boolean frozen;
    float rate = 20f;
    boolean guardAllowed = true;
    Ledger ledgerOverride;

    @Test
    void everyEventAttributeKeyPassesTheRealAllowList() {
        RecordingLedger rec = new RecordingLedger();
        ledgerOverride = rec;
        collector().start(ctx());
        assertEquals(
                List.of(AttrKeys.SERVER_TICK, AttrKeys.DURATION_MS, AttrKeys.TICK_OVERRUNS, AttrKeys.WORLD),
                rec.eventFields(Names.Events.SERVER_SLOW_TICK));
        assertEquals(List.of(), rec.rejectedEventKeys());
    }

    @SuppressWarnings("unchecked")
    CollectorContext ctx() {
        EventLog ev = (EventLog) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
                    if (m.getName().equals("emitMap")) {
                        assertEquals(Names.Events.SERVER_STALL, a[0]);
                        assertEquals(Severity.WARN, a[1]);
                        stallEvents.add((Map<String, Object>) a[2]);
                    }
                    return m.getName().equals("register") ? 3 : null;
                });
        CollectorGuard g = new CollectorGuard() {
            public boolean allowed() {
                return guardAllowed;
            }

            public long begin() {
                return 0;
            }

            public void end(long t) {}
        };
        Ledger l = (Ledger) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
                    switch (m.getName()) {
                        case "events":
                            return ev;
                        case "guard":
                            return g;
                        case "config":
                            return LedgerConfig.defaults();
                        case "counter":
                            String n = (String) a[0];
                            return (Counter) v -> (BoundCounter) k -> counterAdds.add(n + "+" + k);
                        case "histogram":
                            return (dev.geldar.ledger.core.Histogram) v -> d -> {};
                        case "gaugeLong":
                            longGauges.put((String) a[0], (LongSupplier) a[3]);
                            return null;
                        case "gaugeDouble":
                            doubleGauges.put((String) a[0], (DoubleSupplier) a[3]);
                            return null;
                        default:
                            return null;
                    }
                });
        HostScheduler s = new HostScheduler() {
            public Cancellable everyTicks(int ticks, Runnable r) {
                assertEquals(100, ticks);
                main.add(r);
                return () -> cancels++;
            }

            public Cancellable everyMillis(long ms, Runnable r) {
                async.add(r);
                return () -> cancels++;
            }
        };
        HostInfo h = new HostInfo() {
            public long serverTick() {
                return 77;
            }

            public boolean isMainThread() {
                return false;
            }

            public String loaderName() {
                return "test";
            }
        };
        return new CollectorContext() {
            public Ledger ledger() {
                return ledgerOverride != null ? ledgerOverride : l;
            }

            public HostScheduler scheduler() {
                return s;
            }

            public HostInfo host() {
                return h;
            }
        };
    }

    TickCollector collector() {
        ServerTickManager m = (ServerTickManager) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {ServerTickManager.class}, (p, me, a) -> {
                    switch (me.getName()) {
                        case "getTickRate":
                            return rate;
                        case "isFrozen":
                            return frozen;
                        default:
                            setterCalls++;
                            throw new AssertionError("tick manager call " + me.getName());
                    }
                });
        return new TickCollector(registered::add, () -> m, () -> new double[] {20, 20, 20}, clock::get);
    }

    @Test
    void idAndFactoryName() throws Exception {
        assertEquals("tick", collector().id());
        assertEquals("dev.geldar.ledger.paper.tick.TickCollector", TickCollector.class.getName());
        // the factory builds it by reflection with a public no-arg constructor
        assertEquals(TickCollector.class, TickCollector.class.getDeclaredConstructor().newInstance().getClass());
    }

    @Test
    void stallReportsOncePerStallWithCounterAndOneEvent() {
        TickCollector c = collector();
        c.start(ctx());
        assertEquals(1, registered.size());
        Runnable check = async.get(1); // 0 is the TPS refresh, 1 the stall check
        clock.set(1_000_000_000L);
        check.run();
        assertTrue(stallEvents.isEmpty());
        clock.set(2_500_000_000L); // default threshold is 2000 ms
        check.run();
        check.run();
        assertEquals(1, stallEvents.size());
        assertEquals(77L, stallEvents.get(0).get("geldar.server_tick"));
        assertEquals(List.of("geldar_tick_stalls_total+1"), counterAdds);
    }

    @Test
    void stallCheckIsSilentWhenGuardIsOff() {
        collector().start(ctx());
        guardAllowed = false;
        clock.set(9_000_000_000L);
        async.get(1).run();
        assertTrue(stallEvents.isEmpty());
        assertTrue(counterAdds.isEmpty());
    }

    @Test
    void tickManagerIsSampledWithGettersOnly() {
        TickCollector c = collector();
        c.start(ctx());
        assertEquals(20.0, doubleGauges.get(Names.Tick.RATE_TARGET).getAsDouble());
        assertEquals(0, longGauges.get(Names.Tick.FROZEN).getAsLong());
        rate = 5f;
        frozen = true;
        assertEquals(20.0, doubleGauges.get(Names.Tick.RATE_TARGET).getAsDouble()); // reader is a cached read
        main.get(0).run();
        assertEquals(5.0, doubleGauges.get(Names.Tick.RATE_TARGET).getAsDouble());
        assertEquals(1, longGauges.get(Names.Tick.FROZEN).getAsLong());
        assertEquals(0, setterCalls);
    }

    @Test
    void stopCancelsAllTasksAndIsIdempotent() {
        TickCollector c = collector();
        c.start(ctx());
        c.stop();
        assertEquals(3, cancels); // tps refresh, manager sample, stall check
        c.stop();
        assertEquals(3, cancels);
    }

    @Test
    void managerFailureNeverEscapes() {
        TickCollector c = new TickCollector(registered::add, () -> {
            throw new IllegalStateException("x");
        }, () -> new double[] {20, 20, 20}, clock::get);
        c.start(ctx());
        main.get(0).run();
        assertEquals(20.0, doubleGauges.get(Names.Tick.RATE_TARGET).getAsDouble());
    }
}