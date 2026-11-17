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
import net.kyori.adventure.text.Component;
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

    /** A guard that counts calls, for a main-thread registry. */
    static final class CountingGuard {
        int begins;
        int ends;
        boolean allowed = true;
        final CollectorGuard guard = (CollectorGuard) Proxy.newProxyInstance(
                CollectorGuard.class.getClassLoader(), new Class<?>[] {CollectorGuard.class}, (p, m, a) -> {
                    switch (m.getName()) {
                        case "allowed":
                            return allowed;
                        case "begin":
                            begins++;
                            return 7L;
                        case "end":
                            ends++;
                            return null;
                        default:
                            throw new AssertionError("guard touched: " + m.getName());
                    }
                });
    }

    private CuratedRegistry mainRegistry(CountingGuard g, List<EventExecutor> out) {
        FakeHostInfo main = new FakeHostInfo().mainThread(true);
        return new CuratedRegistry(new RecordingLedger(main).events(), ledger.content(), g.guard, main,
                new CuratedRegistry.Binder() {
                    @Override
                    public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignoreCancelled) {
                        out.add(executor);
                    }

                    @Override
                    public void unbindAll() {}
                });
    }

    @Test
    void anExhaustedBucketNeverCallsTheExtractor() throws Exception {
        int[] calls = {0};
        registry.onContent(Spoken.class, "geldar.chat", 1, new String[] {"geldar.world"}, true, (e, s) -> {
            calls[0]++;
            s.text = "x";
        });
        for (int i = 0; i < 6; i++) {
            executors.get(0).execute(null, new Spoken());
        }
        assertEquals(1, calls[0]);
        assertEquals(5, registry.contentRateDrops());
    }

    @Test
    void aMainThreadContentEventRunsUnderTheGuardAndEndsItEvenOnError() throws Exception {
        CountingGuard g = new CountingGuard();
        List<EventExecutor> ex = new ArrayList<>();
        CuratedRegistry r = mainRegistry(g, ex);
        r.onContent(Spoken.class, "geldar.sign", 20, new String[] {"geldar.world"}, true, (e, s) -> s.text = "x");
        ex.get(0).execute(null, new Spoken());
        assertEquals(1, g.begins);
        assertEquals(1, g.ends);
        assertEquals(1, ledger.content("geldar.sign").size());
        r.onContent(Spoken.class, "geldar.book", 20, new String[] {"geldar.world"}, true, (e, s) -> {
            throw new IllegalStateException("boom");
        });
        ex.get(1).execute(null, new Spoken());
        assertEquals(2, g.begins);
        assertEquals(2, g.ends);
        assertEquals(1, r.errorCount());
    }

    @Test
    void aMainThreadEventIsSkippedWhenTheGuardIsOffAndAnExhaustedBucketNeverBegins() throws Exception {
        CountingGuard g = new CountingGuard();
        g.allowed = false;
        List<EventExecutor> ex = new ArrayList<>();
        CuratedRegistry r = mainRegistry(g, ex);
        int[] calls = {0};
        r.onContent(Spoken.class, "geldar.sign", 20, new String[] {"geldar.world"}, true, (e, s) -> {
            calls[0]++;
            s.text = "x";
        });
        ex.get(0).execute(null, new Spoken());
        assertEquals(0, calls[0]);
        assertEquals(0, g.begins);
        assertTrue(ledger.content("geldar.sign").isEmpty());
        CountingGuard g2 = new CountingGuard();
        List<EventExecutor> ex2 = new ArrayList<>();
        CuratedRegistry r2 = mainRegistry(g2, ex2);
        r2.onContent(Spoken.class, "geldar.book", 1, new String[] {"geldar.world"}, true, (e, s) -> {
            calls[0]++;
            s.text = "x";
        });
        ex2.get(0).execute(null, new Spoken());
        ex2.get(0).execute(null, new Spoken()); // bucket empty: no begin, no extract
        assertEquals(1, calls[0]);
        assertEquals(1, g2.begins);
        assertEquals(1, g2.ends);
    }

    @Test
    void aComponentNestedSixHundredDeepIsSwallowedAndCounted() throws Exception {
        Component deep = Component.text("x");
        for (int i = 0; i < 600; i++) {
            deep = Component.text("y").append(deep);
        }
        Component c = deep;
        fire((e, s) -> s.text = PlainText.bounded(c, 1000), 20);
        assertEquals(1, registry.errorCount());
        assertTrue(ledger.content("geldar.chat").isEmpty());
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
