package dev.geldar.ledger.paper.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.Severity;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

class CuratedRegistryTest {
    static class EvA extends Event {
        private static final HandlerList HANDLERS = new HandlerList();
        final long value;

        EvA(long value) {
            this.value = value;
        }

        public static HandlerList getHandlerList() {
            return HANDLERS;
        }

        @Override
        public HandlerList getHandlers() {
            return HANDLERS;
        }
    }

    /** Shares its parent's handler list, like BlockMultiPlaceEvent. */
    static class EvChild extends EvA {
        EvChild() {
            super(9);
        }
    }

    static final class FakeBinder implements CuratedRegistry.Binder {
        final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
        final List<Boolean> ignoreCancelled = new ArrayList<>();
        int unbindCalls;

        @Override
        public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignore) {
            executors.put(type, executor);
            ignoreCancelled.add(ignore);
        }

        @Override
        public void unbindAll() {
            unbindCalls++;
            executors.clear();
        }

        void fire(Class<?> type, Event e) throws Exception {
            executors.get(type).execute(new org.bukkit.event.Listener() {}, e);
        }
    }

    static final String[] FIELDS = {"geldar.x", "geldar.life_id", "geldar.block"};

    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
    final FakeBinder binder = new FakeBinder();
    final CuratedRegistry registry =
            new CuratedRegistry(ledger.events(), ledger.guard(CuratedCollector.ID), host, binder);

    @Test
    void anExecutorRecordsTheExtractedFields() throws Exception {
        registry.on(EvA.class, "geldar.test.a", Severity.INFO, FIELDS, true, (e, s) -> {
            s.l1 = e.value;
            s.s2 = "STONE";
        });
        binder.fire(EvA.class, new EvA(42));
        List<RecordingLedger.EventRecord> got = ledger.events("geldar.test.a");
        assertEquals(1, got.size());
        assertEquals(42, got.get(0).a());
        assertEquals("STONE", got.get(0).s2());
        assertEquals(List.of(true), binder.ignoreCancelled);
        assertEquals(List.of("geldar.x", "geldar.life_id", "geldar.block"), ledger.eventFields("geldar.test.a"));
    }

    @Test
    void theSinkIsClearedBetweenEvents() throws Exception {
        registry.on(EvA.class, "geldar.test.a", Severity.INFO, FIELDS, false, (e, s) -> {
            if (e.value == 1) {
                s.l1 = 7;
                s.s1 = "ag_x_01";
            }
        });
        binder.fire(EvA.class, new EvA(1));
        binder.fire(EvA.class, new EvA(2));
        List<RecordingLedger.EventRecord> got = ledger.events("geldar.test.a");
        assertEquals(2, got.size());
        assertEquals(0, got.get(1).a());
        assertEquals(null, got.get(1).s1());
    }

    @Test
    void skipRecordsNothing() throws Exception {
        registry.on(EvA.class, "geldar.test.a", Severity.INFO, FIELDS, true, (e, s) -> s.skip());
        binder.fire(EvA.class, new EvA(1));
        assertEquals(0, ledger.events("geldar.test.a").size());
    }

    @Test
    void anEventOfAnotherClassSharingTheHandlerListIsIgnored() throws Exception {
        registry.on(EvChild.class, "geldar.test.child", Severity.INFO, FIELDS, true, (e, s) -> s.l1 = 1);
        binder.fire(EvChild.class, new EvA(5)); // delivered through the shared list, not a child
        assertEquals(0, ledger.events("geldar.test.child").size());
        assertEquals(0, registry.errorCount()); // filtered, not cast and failed
        binder.fire(EvChild.class, new EvChild());
        assertEquals(1, ledger.events("geldar.test.child").size());
    }

    @Test
    void aThrowingExtractorIsSwallowedCountedAndRecordsNothing() throws Exception {
        registry.on(EvA.class, "geldar.test.a", Severity.INFO, FIELDS, true, (e, s) -> {
            throw new NoClassDefFoundError("boom"); // an Error: the guard catches Throwable, not only exceptions
        });
        binder.fire(EvA.class, new EvA(1));
        assertEquals(1, registry.errorCount());
        assertEquals(0, ledger.events("geldar.test.a").size());
    }

    @Test
    void anEventOffTheMainThreadIsIgnored() throws Exception {
        registry.on(EvA.class, "geldar.test.a", Severity.INFO, FIELDS, true, (e, s) -> s.l1 = 1);
        host.mainThread(false);
        binder.fire(EvA.class, new EvA(1));
        assertEquals(0, ledger.events("geldar.test.a").size());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void anExcludedClassIsRefusedAndNotBound() {
        assertThrows(
                IllegalArgumentException.class,
                () -> registry.on(PlayerLoginEvent.class, "geldar.test.login", Severity.INFO, FIELDS, true, (e, s) -> {}));
        assertTrue(binder.executors.isEmpty());
        assertEquals(0, registry.registeredCount());
    }

    // --- collector ---

    private CollectorContext ctx(Ledger l) {
        return new CollectorContext() {
            @Override
            public Ledger ledger() {
                return l;
            }

            @Override
            public HostScheduler scheduler() {
                return new FakeHostScheduler();
            }

            @Override
            public HostInfo host() {
                return host;
            }
        };
    }

    private RecordingLedger configured(String... kv) {
        Properties p = new Properties();
        for (int i = 0; i < kv.length; i += 2) {
            p.setProperty(kv[i], kv[i + 1]);
        }
        return new RecordingLedger(host, ConfigParser.parse(p).config());
    }

    static final class Ok implements CuratedFamily {
        @Override
        public void register(CuratedRegistry r) {
            r.on(EvA.class, "geldar.test.ok", Severity.INFO, FIELDS, true, (e, s) -> s.l1 = 3);
        }
    }

    static final class Throws implements CuratedFamily {
        @Override
        public void register(CuratedRegistry r) {
            throw new IllegalStateException("boom");
        }
    }

    private CuratedCollector collector(FakeBinder b, CuratedFamily... families) {
        return new CuratedCollector(() -> b, () -> List.of(families), java.util.logging.Logger::getAnonymousLogger);
    }

    @Test
    void theCollectorIsOffUnlessEnabledExplicitly() {
        FakeBinder b = new FakeBinder();
        CuratedCollector c = collector(b, new Ok());
        c.start(ctx(configured()));
        assertTrue(b.executors.isEmpty());
        c.start(ctx(configured("collector.curated.enabled", "false")));
        assertTrue(b.executors.isEmpty());
    }

    @Test
    void aFamilyThatThrowsLeavesTheOthersRegisteredAndStopUnregisters() {
        FakeBinder b = new FakeBinder();
        CuratedCollector c = collector(b, new Throws(), new Ok());
        c.start(ctx(configured("collector.curated.enabled", "true")));
        assertEquals(1, c.familiesStarted());
        assertEquals(1, b.executors.size());
        c.stop();
        assertTrue(b.executors.isEmpty());
        c.stop(); // idempotent
        assertTrue(b.unbindCalls >= 1);
    }

    @Test
    void aRestartDoesNotLeaveTheOldExecutorsBehind() {
        FakeBinder b = new FakeBinder();
        CuratedCollector c = collector(b, new Ok());
        c.start(ctx(configured("collector.curated.enabled", "true")));
        c.start(ctx(configured("collector.curated.enabled", "true")));
        assertEquals(1, b.unbindCalls);
        assertEquals(1, b.executors.size());
    }

    @Test
    void theCollectorIsAnIdentifiedCollector() {
        Collector c = collector(new FakeBinder());
        assertEquals("curated", c.id());
    }

    @Test
    void familiesAreResolvedByNameAndMissingOnesSkipped() {
        List<CuratedFamily> loaded = CuratedFamilies.load(CuratedRegistryTest.class.getClassLoader());
        assertTrue(loaded.stream().anyMatch(f -> f instanceof BlocksItemsFamily));
        assertEquals(6, CuratedFamilies.NAMES.size());
        assertEquals(
                loaded.size(),
                loaded.stream().map(f -> f.getClass().getName()).distinct().count());
    }
}
