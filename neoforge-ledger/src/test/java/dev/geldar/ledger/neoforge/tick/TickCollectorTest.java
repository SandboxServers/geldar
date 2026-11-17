package dev.geldar.ledger.neoforge.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.neoforge.world.WorldTickGauges;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.DoubleSupplier;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/** Pure-logic tests: no Minecraft classes, a fake ledger, a fake clock and a latch-driven watchdog sleeper. */
class TickCollectorTest {
    final AtomicLong clock = new AtomicLong(1_000_000_000L);
    final List<Double> lag = new CopyOnWriteArrayList<>();
    final AtomicLong overruns = new AtomicLong();
    final AtomicLong stalls = new AtomicLong();
    final List<String> slowRecords = new CopyOnWriteArrayList<>();
    final List<String> stallEvents = new CopyOnWriteArrayList<>();
    final List<String> registeredEventFields = new ArrayList<>();
    final Map<String, DoubleSupplier> doubleGauges = new HashMap<>();
    final List<List<String>> gaugeAttrs = new ArrayList<>();
    final AtomicBoolean guardAllowed = new AtomicBoolean(true);
    final AtomicBoolean lagThrows = new AtomicBoolean();
    final Semaphore permits = new Semaphore(0);
    final Semaphore asleep = new Semaphore(0);
    volatile Thread sleeperThread;
    volatile Thread stallThread;

    final StallWatchdog.Sleeper sleeper = ms -> {
        sleeperThread = Thread.currentThread();
        asleep.release();
        permits.acquire();
    };

    private Ledger ledger() {
        EventLog events = (EventLog) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
                    switch (m.getName()) {
                        case "register" -> {
                            for (int i = 3; i < a.length; i++) {
                                for (Object o : (Object[]) a[i]) {
                                    registeredEventFields.add((String) o);
                                }
                            }
                            return 7;
                        }
                        case "record" -> slowRecords.add(a[1] + "," + a[2] + "," + a[3]);
                        case "emitMap" -> {
                            stallThread = Thread.currentThread();
                            stallEvents.add(a[0] + "|" + a[1] + "|" + a[2]);
                        }
                        default -> throw new UnsupportedOperationException(m.getName());
                    }
                    return null;
                });
        CollectorGuard guard = new CollectorGuard() {
            public boolean allowed() {
                return guardAllowed.get();
            }

            public long begin() {
                return 0;
            }

            public void end(long token) {}
        };
        return (Ledger) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "counter" -> {
                    String name = (String) a[0];
                    return (dev.geldar.ledger.core.Counter) v -> n -> {
                        if (name.equals(Names.Tick.STALLS_TOTAL)) {
                            stalls.addAndGet(n);
                        } else {
                            overruns.addAndGet(n);
                        }
                    };
                }
                case "histogram" -> {
                    return (dev.geldar.ledger.core.Histogram) v -> x -> {
                        if (lagThrows.get()) {
                            throw new IllegalStateException("boom");
                        }
                        lag.add(x);
                    };
                }
                case "gaugeDouble" -> {
                    doubleGauges.put((String) a[0], (DoubleSupplier) a[3]);
                    gaugeAttrs.add(List.of((String[]) a[4]));
                    return null;
                }
                case "events" -> {
                    return events;
                }
                case "guard" -> {
                    return guard;
                }
                case "config" -> {
                    return LedgerConfig.defaults();
                }
                default -> throw new UnsupportedOperationException(m.getName());
            }
        });
    }

    private CollectorContext ctx(Ledger l) {
        return new CollectorContext() {
            public Ledger ledger() {
                return l;
            }

            public HostScheduler scheduler() {
                return new HostScheduler() {
                    public Cancellable everyTicks(int t, Runnable r) {
                        throw new AssertionError("the tick collector must not use the host scheduler");
                    }

                    public Cancellable everyMillis(long ms, Runnable r) {
                        throw new AssertionError("the stall watchdog must not use the host scheduler");
                    }
                };
            }

            public HostInfo host() {
                return new HostInfo() {
                    public long serverTick() {
                        return 42;
                    }

                    public boolean isMainThread() {
                        return false;
                    }

                    public String loaderName() {
                        return "neoforge";
                    }
                };
            }
        };
    }

    private TickListener started(Map<String, Supplier<long[]>> dims, TickCollector[] out) {
        TickCollector c = new TickCollector(dims, clock::get, sleeper);
        out[0] = c;
        c.start(ctx(ledger()));
        return c.listener();
    }

    private void tick(TickListener l, long ms) {
        l.pre();
        clock.addAndGet(ms * 1_000_000L);
        l.post(5);
    }

    @Test
    void postRecordsTheDurationOfEachTick() {
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of(), c);
        tick(l, 30);
        tick(l, 5);
        assertEquals(List.of(30.0, 5.0), lag);
        assertEquals(0, overruns.get());
        assertTrue(slowRecords.isEmpty());
        c[0].stop();
    }

    @Test
    void overrunIsStrictlyOver50AndSlowIsStrictlyOver100() {
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of(), c);
        tick(l, 50);
        assertEquals(0, overruns.get());
        tick(l, 60);
        assertEquals(1, overruns.get());
        assertTrue(slowRecords.isEmpty());
        tick(l, 100);
        assertTrue(slowRecords.isEmpty());
        tick(l, 150);
        assertEquals(List.of("5,150,3"), slowRecords);
        c[0].stop();
    }

    @Test
    void postWithoutPreRecordsNothing() {
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of(), c);
        l.post(1);
        tick(l, 10);
        l.post(2); // the pre stamp was consumed by the previous post
        assertEquals(List.of(10.0), lag);
        c[0].stop();
    }

    @Test
    void aSwitchedOffGuardRecordsNothingAndAThrowingInstrumentNeverEscapes() {
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of(), c);
        guardAllowed.set(false);
        tick(l, 30);
        assertTrue(lag.isEmpty());
        guardAllowed.set(true);
        lagThrows.set(true);
        tick(l, 30); // must not throw
        lagThrows.set(false);
        tick(l, 20);
        assertEquals(List.of(20.0), lag);
        c[0].stop();
    }

    @Test
    void eventFieldsAndGaugeAttributeKeysPassTheAllowLists() {
        TickCollector[] c = new TickCollector[1];
        started(Map.of("minecraft:overworld", () -> new long[0]), c);
        assertEquals(
                List.of(AttrKeys.SERVER_TICK, AttrKeys.DURATION_MS, AttrKeys.TICK_OVERRUNS, AttrKeys.WORLD),
                registeredEventFields);
        assertEquals(List.of(List.of(AttrKeys.M_WORLD, "minecraft:overworld")), gaugeAttrs);
        assertTrue(AttrKeys.metricAllowed(AttrKeys.M_WORLD));
        c[0].stop();
    }

    @Test
    void aStallIsReportedOnceFromTheWatchdogThreadAndANewHeartbeatRearmsIt() throws Exception {
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of(), c);
        tick(l, 10);
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        clock.addAndGet(3_000_000_000L); // over the 2000 ms default
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS)); // back asleep: the check ran
        assertEquals(1, stalls.get());
        assertEquals(1, stallEvents.size());
        assertTrue(stallEvents.get(0).contains(Names.Events.SERVER_STALL));
        assertNotNull(stallThread);
        assertEquals(sleeperThread, stallThread);
        assertEquals(StallWatchdog.THREAD_NAME, stallThread.getName());
        assertTrue(stallThread.isDaemon());
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        assertEquals(1, stalls.get()); // same stall, not reported twice
        tick(l, 10); // heartbeat
        clock.addAndGet(3_000_000_000L);
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        assertEquals(2, stalls.get());
        c[0].stop();
    }

    @Test
    void noStallBelowTheThresholdAndNoneWhileTheGuardIsOff() throws Exception {
        TickCollector[] c = new TickCollector[1];
        started(Map.of(), c);
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        clock.addAndGet(1_000_000_000L);
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        assertEquals(0, stalls.get());
        clock.addAndGet(5_000_000_000L);
        guardAllowed.set(false);
        permits.release();
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        assertEquals(0, stalls.get());
        c[0].stop();
    }

    @Test
    void stopEndsTheWatchdogThreadIsIdempotentAndClearsTheListener() throws Exception {
        TickCollector[] c = new TickCollector[1];
        started(Map.of(), c);
        assertTrue(asleep.tryAcquire(5, TimeUnit.SECONDS));
        Thread t = sleeperThread;
        assertTrue(t.isAlive());
        c[0].stop();
        assertFalse(t.isAlive());
        assertNull(c[0].listener());
        c[0].stop();
        c[0].start(ctx(ledger())); // restart works and replaces the listener
        assertNotNull(c[0].listener());
        c[0].stop();
    }

    @Test
    void worldGaugeFollowsTheRingEvery20TicksWithoutReadingItFromTheGaugeReader() {
        long[] ring = new long[100];
        java.util.Arrays.fill(ring, 0, 4, 10_000_000L); // 4 filled slots of 10 ms; the rest still zero
        int[] reads = {0};
        TickCollector[] c = new TickCollector[1];
        TickListener l = started(Map.of("minecraft:overworld", () -> {
            reads[0]++;
            return ring;
        }), c);
        DoubleSupplier reader = doubleGauges.values().iterator().next();
        assertEquals(0.0, reader.getAsDouble());
        for (int i = 0; i < WorldTickGauges.SAMPLE_EVERY_TICKS - 1; i++) {
            tick(l, 1);
        }
        assertEquals(0, reads[0]);
        assertEquals(0.0, reader.getAsDouble());
        tick(l, 1);
        assertEquals(1, reads[0]);
        assertEquals(10.0, reader.getAsDouble());
        reader.getAsDouble();
        assertEquals(1, reads[0]);
        c[0].stop();
    }
}
