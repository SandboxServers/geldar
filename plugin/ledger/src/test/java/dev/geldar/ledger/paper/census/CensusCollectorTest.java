package dev.geldar.ledger.paper.census;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredListener;
import org.junit.jupiter.api.Test;

class CensusCollectorTest {
    static class EvA extends Event implements Cancellable {
        private static final HandlerList HANDLERS = new HandlerList();
        boolean cancelled;

        public static HandlerList getHandlerList() {
            return HANDLERS;
        }

        @Override
        public HandlerList getHandlers() {
            return HANDLERS;
        }

        @Override
        public boolean isCancelled() {
            return cancelled;
        }

        @Override
        public void setCancelled(boolean cancel) {
            cancelled = cancel;
        }
    }

    static class EvB extends Event {
        private static final HandlerList HANDLERS = new HandlerList();

        public static HandlerList getHandlerList() {
            return HANDLERS;
        }

        @Override
        public HandlerList getHandlers() {
            return HANDLERS;
        }
    }

    static final String A = EvA.class.getName();
    static final String B = EvB.class.getName();
    /** Metric labels: the simple name of the qualified name (a nested class keeps its outer prefix). */
    static final String LA = "CensusCollectorTest$EvA";
    static final String LB = "CensusCollectorTest$EvB";

    /** Records executors; throws for the classes in {@code failing}. */
    static final class FakeRegistrar implements CensusRegistrar {
        final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
        final List<Class<?>> failing = new ArrayList<>();
        int unregisterCalls;

        @Override
        public void register(Class<? extends Event> type, EventExecutor executor) {
            if (failing.contains(type)) {
                throw new IllegalStateException("boom");
            }
            executors.put(type, executor);
        }

        @Override
        public void unregisterAll() {
            unregisterCalls++;
            executors.clear();
        }
    }

    static final class Rig {
        final FakeHostInfo host = new FakeHostInfo();
        final FakeHostScheduler scheduler = new FakeHostScheduler();
        final FakeRegistrar registrar = new FakeRegistrar();
        final List<String> logs = new ArrayList<>();
        final Logger logger = Logger.getAnonymousLogger();
        final RecordingLedger ledger;
        final CensusCollector collector;

        Rig(List<String> names, String... kv) {
            Properties p = new Properties();
            for (int i = 0; i < kv.length; i += 2) {
                p.setProperty(kv[i], kv[i + 1]);
            }
            LedgerConfig config = ConfigParser.parse(p).config();
            ledger = new RecordingLedger(host, config);
            logger.setUseParentHandlers(false);
            logger.addHandler(new Handler() {
                @Override
                public void publish(LogRecord r) {
                    logs.add(r.getMessage());
                }

                @Override
                public void flush() {}

                @Override
                public void close() {}
            });
            collector = new CensusCollector(() -> names, () -> registrar, CensusCollectorTest.class.getClassLoader(), () -> logger);
        }

        Rig start() {
            collector.start(new CollectorContext() {
                @Override
                public Ledger ledger() {
                    return ledger;
                }

                @Override
                public HostScheduler scheduler() {
                    return scheduler;
                }

                @Override
                public HostInfo host() {
                    return host;
                }
            });
            return this;
        }

        void fire(Class<?> type, Event e) throws Exception {
            registrar.executors.get(type).execute(null, e);
        }
    }

    private static final String ENABLE = "collector.census.enabled";

    @Test
    void idIsCensus() {
        assertEquals("census", new CensusCollector().id());
        assertEquals("census", CensusCollector.ID);
    }

    @Test
    void offUnlessExplicitlyEnabled() {
        Rig r = new Rig(List.of(A, B)).start();
        assertEquals(0, r.registrar.executors.size());
        Rig off = new Rig(List.of(A, B), ENABLE, "false").start();
        assertEquals(0, off.registrar.executors.size());
        Rig on = new Rig(List.of(A, B), ENABLE, "true").start();
        assertEquals(2, on.registrar.executors.size());
    }

    @Test
    void cancelledEventBumpsTheTrueSeries() throws Exception {
        Rig r = new Rig(List.of(A, B), ENABLE, "true").start();
        EvA plain = new EvA();
        EvA cancelled = new EvA();
        cancelled.setCancelled(true);
        r.fire(EvA.class, plain);
        r.fire(EvA.class, cancelled);
        r.fire(EvA.class, cancelled);
        assertEquals(1, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "false"));
        assertEquals(2, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "true"));
        r.fire(EvB.class, new EvB()); // not Cancellable: counted as false
        assertEquals(1, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LB, "false"));
        assertEquals(0, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LB, "true"));
    }

    @Test
    void dutyCycledClassCountsOnlyInItsOnWindow() throws Exception {
        Rig r = new Rig(List.of(A, B), ENABLE, "true", "collector.census.duty." + LA, "5/20").start();
        for (long tick = 0; tick < 40; tick++) {
            r.host.serverTick(tick);
            r.fire(EvA.class, new EvA());
            r.fire(EvB.class, new EvB());
        }
        assertEquals(10, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "false"));
        assertEquals(40, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LB, "false"));
        // the ratio is published once, from an async run, for the duty-cycled class only
        assertEquals(0, r.ledger.registrations(Names.Census.EVENT_DUTY_RATIO).size());
        r.scheduler.advanceMillis(1000);
        assertEquals(1, r.ledger.registrations(Names.Census.EVENT_DUTY_RATIO).size());
        assertEquals(0.25, r.ledger.readGaugeDouble(Names.Census.EVENT_DUTY_RATIO, LA), 1e-9);
        r.scheduler.advanceMillis(3000);
        assertEquals(1, r.ledger.registrations(Names.Census.EVENT_DUTY_RATIO).size());
    }

    @Test
    void defaultDutyTableIsFiveOfTwenty() {
        assertEquals(16, DefaultDuty.HIGH_RATE.size());
        for (String n : DefaultDuty.HIGH_RATE) {
            assertEquals(new LedgerConfig.Duty(5, 20), DefaultDuty.forSimpleName(n));
        }
        assertEquals(null, DefaultDuty.forSimpleName("PlayerJoinEvent"));
    }

    @Test
    void stopLeavesNoListenersAndIsIdempotent() throws Exception {
        Rig r = new Rig(List.of(A, B), ENABLE, "true").start();
        EventExecutor executor = r.registrar.executors.get(EvA.class);
        r.collector.stop();
        r.collector.stop();
        assertEquals(0, r.registrar.executors.size());
        assertEquals(0, r.collector.registeredCount());
        assertTrue(r.registrar.unregisterCalls >= 1);
        executor.execute(null, new EvA()); // a late event is ignored and does not throw
        assertEquals(0, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "false"));
    }

    @Test
    void aRegistrarThatThrowsForOneClassLeavesTheRest() {
        Rig r = new Rig(List.of(A, B, "no.such.Event", String.class.getName()), ENABLE, "true");
        r.registrar.failing.add(EvA.class);
        r.start();
        assertEquals(1, r.registrar.executors.size());
        assertTrue(r.registrar.executors.containsKey(EvB.class));
        assertEquals(1, r.collector.registeredCount());
        assertEquals(3, r.collector.skippedCount());
        assertEquals(1, r.logs.size(), "one bounded summary line");
        assertTrue(r.logs.get(0).contains("3 skipped"));
    }

    @Test
    void anExcludedClassIsNeverRegisteredEvenIfListed() {
        Rig r = new Rig(List.of(org.bukkit.event.player.PlayerLoginEvent.class.getName(), B), ENABLE, "true").start();
        assertEquals(List.of(EvB.class), new ArrayList<>(r.registrar.executors.keySet()));
    }

    @Test
    void aBudgetDisabledGuardStopsCounting() throws Exception {
        Rig r = new Rig(List.of(A), ENABLE, "true").start();
        r.ledger.fakeGuard("census").disable();
        r.fire(EvA.class, new EvA());
        assertEquals(0, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "false"));
    }

    @Test
    void anExecutorNeverThrowsIntoTheHost() throws Exception {
        Rig r = new Rig(List.of(A), ENABLE, "true").start();
        r.fire(EvA.class, null); // not an instance: ignored
        r.fire(EvA.class, new EvA() {
            @Override
            public boolean isCancelled() {
                throw new IllegalStateException("boom");
            }
        });
        assertEquals(0, r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, LA, "false"));
    }

    @Test
    void executorNeverReadsEventContent() throws Exception {
        List<String> calls = new ArrayList<>();
        Rig r = new Rig(List.of(B), ENABLE, "true").start();
        r.fire(EvB.class, new EvB() {
            @Override
            public HandlerList getHandlers() {
                calls.add("getHandlers");
                return super.getHandlers();
            }

            @Override
            public String getEventName() {
                calls.add("getEventName");
                return "x";
            }
        });
        assertEquals(List.of(), calls);
    }

    // label rule

    @Test
    void uniqueSimpleNamesKeepTheirSimpleName() {
        assertEquals(List.of("AEvent", "BEvent"), CensusCollector.labels(List.of("x.y.AEvent", "x.z.BEvent")));
    }

    @Test
    void collidingSimpleNamesGetTheShortestDistinctPackageSuffix() {
        assertEquals(
                List.of("block.MoveEvent", "entity.MoveEvent", "Other"),
                CensusCollector.labels(List.of("a.event.block.MoveEvent", "a.event.entity.MoveEvent", "a.event.Other")));
        // the same last package segment: one level deeper for the whole group
        assertEquals(
                List.of("p.block.MoveEvent", "q.block.MoveEvent"),
                CensusCollector.labels(List.of("p.block.MoveEvent", "q.block.MoveEvent")));
        // three-way, mixed depth in the input order does not matter
        assertEquals(
                List.of("c.MoveEvent", "b.MoveEvent", "a.MoveEvent"),
                CensusCollector.labels(List.of("x.c.MoveEvent", "x.b.MoveEvent", "x.a.MoveEvent")));
    }

    @Test
    void collisionLabelsAreUniqueAndCountersAcceptThem() {
        List<String> labels = CensusCollector.labels(List.of("a.x.E", "b.x.E", "c.F"));
        assertEquals(labels.size(), labels.stream().distinct().count());
        assertFalse(labels.contains("E"));
        assertNotNull(new dev.geldar.ledger.core.census.CensusCounters(new RecordingLedger(), labels));
    }

    /** A Plugin and PluginManager proxy that puts the registration into the event's real HandlerList. */
    @Test
    void paperRegistrarUsesOneMonitorListenerAndUnregistersOnlyItself() {
        List<String> seen = new ArrayList<>();
        List<Listener> listeners = new ArrayList<>();
        Plugin plugin = (Plugin) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Plugin.class}, (p, m, a) -> m.getName().equals("isEnabled") ? Boolean.TRUE : null);
        PluginManager pm = (PluginManager) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {PluginManager.class}, (p, m, a) -> {
                    if (m.getName().equals("registerEvent")) {
                        Class<?> type = (Class<?>) a[0];
                        Listener l = (Listener) a[1];
                        listeners.add(l);
                        seen.add(type.getSimpleName() + "/" + a[2] + "/ignoreCancelled=" + a[5]);
                        HandlerList h = type == EvA.class ? EvA.getHandlerList() : EvB.getHandlerList();
                        h.register(new RegisteredListener(l, (EventExecutor) a[3], (EventPriority) a[2], (Plugin) a[4], (Boolean) a[5]));
                    }
                    return null;
                });
        Listener foreign = new Listener() {};
        EvA.getHandlerList().register(new RegisteredListener(foreign, (l, e) -> {}, EventPriority.NORMAL, plugin, false));
        PaperCensusRegistrar reg = new PaperCensusRegistrar(pm, plugin);
        reg.register(EvA.class, (l, e) -> {});
        reg.register(EvB.class, (l, e) -> {});
        assertEquals(List.of("EvA/MONITOR/ignoreCancelled=false", "EvB/MONITOR/ignoreCancelled=false"), seen);
        assertTrue(listeners.get(0) == listeners.get(1), "one shared listener");
        assertEquals(2, EvA.getHandlerList().getRegisteredListeners().length);
        reg.unregisterAll();
        reg.unregisterAll();
        assertEquals(0, EvB.getHandlerList().getRegisteredListeners().length);
        assertEquals(1, EvA.getHandlerList().getRegisteredListeners().length, "the foreign listener stays");
        HandlerList.unregisterAll(foreign);
    }
}
