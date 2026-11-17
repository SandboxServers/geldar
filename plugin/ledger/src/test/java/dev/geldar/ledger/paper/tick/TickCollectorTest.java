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
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
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
    volatile boolean guardThrows;
    volatile Thread sleeperThread;
    final List<String> emitThreads = new java.util.concurrent.CopyOnWriteArrayList<>();
    final Semaphore permits = new Semaphore(0);
    final Semaphore asleep = new Semaphore(0);
    final StallWatchdog.Sleeper fakeSleeper = ms -> {
        sleeperThread = Thread.currentThread();
        asleep.release();
        permits.acquire();
    };

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
                        emitThreads.add(Thread.currentThread().getName());
                    }
                    return m.getName().equals("register") ? 3 : null;
                });
        CollectorGuard g = new CollectorGuard() {
            public boolean allowed() {
                if (guardThrows) {
                    throw new IllegalStateException("x");
                }
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
        return new TickCollector(registered::add, () -> m, () -> new double[] {20, 20, 20}, clock::get, fakeSleeper);
    }

    @Test
    void idAndFactoryName() throws Exception {
        assertEquals("tick", collector().id());
        assertEquals("dev.geldar.ledger.paper.tick.TickCollector", TickCollector.class.getName());
        // the factory builds it by reflection with a public no-arg constructor
        assertEquals(TickCollector.class, TickCollector.class.getDeclaredConstructor().newInstance().getClass());
    }

    @Test
    void stallReportsOncePerStallFromTheWatchdogThread() throws Exception {
        TickCollector c = collector();
        c.start(ctx());
        awaitAsleep();
        assertEquals(1, registered.size());
        assertEquals(1, async.size()); // only the TPS refresh: the stall check is not a scheduler task
        clock.set(1_000_000_000L);
        step();
        assertTrue(stallEvents.isEmpty());
        clock.set(2_500_000_000L); // default threshold is 2000 ms
        step();
        step();
        // Detection: counted once, and an event (geldar.flag=1) exists even if the server never recovers.
        assertEquals(1, stallEvents.size());
        assertEquals(1L, stallEvents.get(0).get("geldar.flag"));
        assertEquals(2500L, stallEvents.get(0).get("geldar.duration_ms")); // the pause so far, over the threshold
        assertEquals(List.of("geldar_tick_stalls_total+1"), counterAdds);
        clock.set(4_000_000_000L);
        heartbeat(); // first new beat
        clock.set(4_200_000_000L);
        heartbeat();
        clock.set(4_400_000_000L); // the poll sees it later
        step();
        step();
        assertEquals(2, stallEvents.size());
        assertEquals(77L, stallEvents.get(1).get("geldar.server_tick"));
        assertEquals(0L, stallEvents.get(1).get("geldar.flag"));
        assertEquals(4000L, stallEvents.get(1).get("geldar.duration_ms")); // measured: first new beat
        assertEquals(List.of("geldar_tick_stalls_total+1"), counterAdds);
        assertEquals(List.of(StallWatchdog.THREAD_NAME, StallWatchdog.THREAD_NAME), emitThreads);
        Thread w = watchdogThread();
        assertTrue(w.isDaemon());
        c.stop();
    }

    @Test
    void stallCheckIsSilentWhenGuardIsOff() throws Exception {
        TickCollector c = collector();
        c.start(ctx());
        awaitAsleep();
        guardAllowed = false;
        clock.set(9_000_000_000L);
        step();
        assertTrue(stallEvents.isEmpty());
        assertTrue(counterAdds.isEmpty());
        c.stop();
    }

    @Test
    void aThrowingCheckDoesNotKillTheWatchdog() throws Exception {
        TickCollector c = collector();
        c.start(ctx());
        awaitAsleep();
        clock.set(9_000_000_000L);
        guardThrows = true;
        step(); // the check throws; the thread lives
        assertTrue(stallEvents.isEmpty());
        guardThrows = false;
        step();
        assertEquals(List.of("geldar_tick_stalls_total+1"), counterAdds);
        assertEquals(1, stallEvents.size());
        assertEquals(9000L, stallEvents.get(0).get("geldar.duration_ms"));
        clock.set(9_500_000_000L);
        heartbeat();
        step();
        assertEquals(2, stallEvents.size());
        assertEquals(9500L, stallEvents.get(1).get("geldar.duration_ms"));
        c.stop();
    }

    @Test
    void aPauseThatEndedWhileTheGuardWasOffIsNeverReportedLater() throws Exception {
        TickCollector c = collector();
        c.start(ctx());
        awaitAsleep();
        guardAllowed = false;
        clock.set(5_000_000_000L);
        step(); // detected silently
        clock.set(6_000_000_000L);
        heartbeat();
        step(); // recovered silently
        guardAllowed = true;
        clock.set(7_000_000_000L);
        heartbeat();
        step();
        assertTrue(stallEvents.isEmpty());
        assertTrue(counterAdds.isEmpty());
        c.stop();
    }

    private void heartbeat() {
        ((TickEndListener) registered.get(0)).onTickEnd(new com.destroystokyo.paper.event.server.ServerTickEndEvent(1, 5.0, 0));
    }

    @Test
    void stopEndsTheWatchdogThreadAndIsIdempotent() throws Exception {
        TickCollector c = collector();
        c.start(ctx());
        awaitAsleep();
        Thread w = watchdogThread();
        c.stop();
        assertTrue(!w.isAlive());
        c.stop();
        assertEquals(2, cancels); // tps refresh, manager sample
        c.start(ctx()); // restart makes a fresh watchdog
        awaitAsleep();
        assertTrue(watchdogThread().isAlive());
        c.stop();
    }

    private void awaitAsleep() throws Exception {
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
    }

    /** Lets the watchdog run one check and waits until it is asleep again. */
    private void step() throws Exception {
        permits.release();
        awaitAsleep();
    }

    private Thread watchdogThread() {
        return sleeperThread;
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
    void managerFailureNeverEscapes() {
        TickCollector c = new TickCollector(registered::add, () -> {
            throw new IllegalStateException("x");
        }, () -> new double[] {20, 20, 20}, clock::get);
        c.start(ctx());
        main.get(0).run();
        assertEquals(20.0, doubleGauges.get(Names.Tick.RATE_TARGET).getAsDouble());
    }
}