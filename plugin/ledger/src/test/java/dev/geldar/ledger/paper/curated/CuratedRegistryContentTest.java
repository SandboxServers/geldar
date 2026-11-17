package dev.geldar.ledger.paper.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.paper.curated.CuratedRegistry.ContentExtractor;
import dev.geldar.ledger.paper.curated.TextContentFamilyTest.Spoken;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.event.Event;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

/** The content path of the registry (PT-07d): any thread, never the guard, failures swallowed and counted. */
class CuratedRegistryContentTest {
    final FakeHostInfo host = new FakeHostInfo().mainThread(false); // as for async chat
    final RecordingLedger ledger = new RecordingLedger(host);
    final List<EventExecutor> executors = new ArrayList<>();
    /** A guard that fails the test on any call: the content path must never touch it. */
    final CollectorGuard forbidden = (CollectorGuard) Proxy.newProxyInstance(
            CollectorGuard.class.getClassLoader(), new Class<?>[] {CollectorGuard.class}, (p, m, a) -> {
                throw new AssertionError("guard touched: " + m.getName());
            });
    final CuratedRegistry registry = new CuratedRegistry(
            ledger.events(), ledger.content(), forbidden, host, new CuratedRegistry.Binder() {
                @Override
                public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignoreCancelled) {
                    executors.add(executor);
                }

                @Override
                public void unbindAll() {
                    executors.clear();
                }
            });

    void fire(ContentExtractor<Spoken> x, int rate) throws Exception {
        executors.clear();
        registry.onContent(Spoken.class, "geldar.chat", rate, new String[] {"geldar.life_id"}, true, x);
        Spoken e = new Spoken();
        Throwable[] failure = {null};
        Thread t = new Thread(() -> {
            try {
                executors.get(0).execute(null, e);
            } catch (Throwable th) {
                failure[0] = th;
            }
        });
        t.start();
        t.join();
        assertEquals(null, failure[0]);
    }

    @Test
    void anAsyncThreadRecordsWithoutTouchingTheGuard() throws Exception {
        fire((e, s) -> {
            s.text = "hello";
            s.s1 = "ag_mira_01";
        }, 20);
        assertEquals(1, ledger.content("geldar.chat").size());
        assertEquals("hello", ledger.content("geldar.chat").get(0).text());
        assertTrue(ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void aThrowingExtractorIsSwallowedAndCounted() throws Exception {
        fire((e, s) -> {
            throw new IllegalStateException("boom");
        }, 20);
        assertEquals(1, registry.errorCount());
        assertTrue(ledger.content("geldar.chat").isEmpty());
    }

    @Test
    void aSkippedEventRecordsNothing() throws Exception {
        fire((e, s) -> s.skip(), 20);
        assertTrue(ledger.content("geldar.chat").isEmpty());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void theRateLimitDropsTheExcessAndCountsIt() throws Exception {
        executors.clear();
        registry.onContent(Spoken.class, "geldar.chat", 1, new String[] {"geldar.world"}, true, (e, s) -> s.text = "x");
        for (int i = 0; i < 5; i++) {
            executors.get(0).execute(null, new Spoken());
        }
        assertEquals(1, ledger.content("geldar.chat").size());
        assertEquals(4, registry.contentRateDrops());
    }

    @Test
    void aSubclassOrOtherEventIsIgnoredAndOldRegistryHasNoContent() throws Exception {
        executors.clear();
        registry.onContent(Spoken.class, "geldar.chat", 20, new String[] {"geldar.world"}, true, (e, s) -> s.text = "x");
        executors.get(0).execute(null, new Event() {
            @Override
            public org.bukkit.event.HandlerList getHandlers() {
                return Spoken.getHandlerList();
            }
        });
        assertTrue(ledger.content("geldar.chat").isEmpty());
        CuratedRegistry old = new CuratedRegistry(ledger.events(), ledger.guard("curated"), host, new CuratedRegistry.Binder() {
            @Override
            public void bind(Class<? extends Event> t, EventExecutor e, boolean i) {}

            @Override
            public void unbindAll() {}
        });
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                () -> old.onContent(Spoken.class, "geldar.chat", 1, new String[0], true, (e, s) -> {}));
    }
}
