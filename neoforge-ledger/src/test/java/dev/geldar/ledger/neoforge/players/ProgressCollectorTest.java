package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Pure-logic tests: no Minecraft classes, a fake ledger, a fake scheduler and a real stats directory. */
class ProgressCollectorTest {
    static final UUID AGENT = new UUID(1, 2);
    static final UUID HUMAN = new UUID(3, 4);
    static final String LIFE = "ag_ada_01";

    @TempDir
    Path dir;

    final List<String> recorded = new CopyOnWriteArrayList<>();
    final List<String> emitted = new CopyOnWriteArrayList<>();
    final List<List<String>> registered = new ArrayList<>();
    final AtomicBoolean main = new AtomicBoolean();
    final AtomicBoolean allowed = new AtomicBoolean(true);
    final AtomicInteger begun = new AtomicInteger();
    final AtomicInteger ended = new AtomicInteger();
    final AtomicInteger tasks = new AtomicInteger();
    final AtomicInteger cancelled = new AtomicInteger();
    Runnable stats;

    static LedgerConfig config(String progress) {
        Properties p = new Properties();
        if (progress != null) {
            p.setProperty("collector.progress.enabled", progress);
        }
        return ConfigParser.parse(p).config();
    }

    private Ledger ledger(LedgerConfig cfg) {
        EventLog events = (EventLog) java.lang.reflect.Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
                    switch (m.getName()) {
                        case "register" -> {
                            assertEquals(Names.Events.PLAYER_ADVANCEMENT, a[0]);
                            List<String> f = new ArrayList<>();
                            for (Object o : (Object[]) a[3]) {
                                f.add((String) o);
                            }
                            registered.add(f);
                            return 5;
                        }
                        case "record" -> recorded.add(a[0] + "," + a[1] + "," + a[4] + "," + a[5] + "," + a[6]);
                        case "emitMap" -> emitted.add(a[0] + "|" + new java.util.TreeMap<>((Map<?, ?>) a[2]));
                        default -> throw new UnsupportedOperationException(m.getName());
                    }
                    return null;
                });
        CollectorGuard guard = new CollectorGuard() {
            public boolean allowed() {
                return allowed.get();
            }

            public long begin() {
                begun.incrementAndGet();
                return 0;
            }

            public void end(long token) {
                ended.incrementAndGet();
            }
        };
        return (Ledger) java.lang.reflect.Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> switch (m.getName()) {
                    case "events" -> events;
                    case "guard" -> guard;
                    case "config" -> cfg;
                    default -> throw new UnsupportedOperationException(m.getName());
                });
    }

    private CollectorContext ctx(Ledger l) {
        HostScheduler sched = new HostScheduler() {
            public Cancellable everyTicks(int t, Runnable r) {
                throw new AssertionError("ticks");
            }

            public Cancellable everyMillis(long ms, Runnable r) {
                assertEquals(ProgressCollector.STATS_MS, ms);
                tasks.incrementAndGet();
                stats = r;
                return cancelled::incrementAndGet;
            }
        };
        HostInfo host = new HostInfo() {
            public long serverTick() {
                return 1;
            }

            public boolean isMainThread() {
                return main.get();
            }

            public String loaderName() {
                return "neoforge";
            }
        };
        return new CollectorContext() {
            public Ledger ledger() {
                return l;
            }

            public HostScheduler scheduler() {
                return sched;
            }

            public HostInfo host() {
                return host;
            }
        };
    }

    private ProgressCollector started(String enabled) {
        ProgressCollector c = new ProgressCollector(() -> dir, ms -> {});
        c.start(ctx(ledger(config(enabled))));
        return c;
    }

    private void statsFile(UUID id, String json) throws IOException {
        Files.writeString(dir.resolve(id + ".json"), json);
    }

    private static final String SAMPLE = "{\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\":3}}}";

    @Test
    void offUnlessExplicitlyEnabled() {
        for (String v : new String[] {null, "false"}) {
            ProgressCollector c = started(v);
            c.join(AGENT, LIFE);
            c.advancement(LIFE, "minecraft:story/root", true);
            assertEquals(0, registered.size(), "register, enabled=" + v);
            assertEquals(0, tasks.get(), "task, enabled=" + v);
            assertTrue(recorded.isEmpty(), "record, enabled=" + v);
        }
        started("true");
        assertEquals(1, registered.size());
        assertEquals(1, tasks.get());
    }

    @Test
    void earnAndGrantRecordLifeIdKeyAndFlagOnly() {
        ProgressCollector c = started("true");
        assertEquals(List.of(AttrKeys.FLAG, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE), registered.get(0));
        c.advancement(LIFE, "minecraft:story/root", true);
        c.advancement(LIFE, "minecraft:story/root", false);
        assertEquals(List.of("5,1," + LIFE + ",minecraft:story/root,", "5,0," + LIFE + ",minecraft:story/root,"), recorded);
        assertEquals(2, begun.get());
        assertEquals(2, ended.get());
    }

    @Test
    void aHumanAdvancementIsDroppedAndNeverNamed() {
        ProgressCollector c = started("true");
        for (String name : new String[] {"Steve", "ag_Ada_01", "", null, "ag_ada_1", "ag_ada_01\n"}) {
            c.advancement(name, "minecraft:story/root", true);
        }
        assertTrue(recorded.isEmpty());
        assertEquals(begun.get(), ended.get());
    }

    @Test
    void onlyShortNamespacedKeysPass() {
        assertEquals("minecraft:story/root", ProgressCollector.key("minecraft:story/root"));
        assertEquals("a_b.c-d:e/f_g", ProgressCollector.key("a_b.c-d:e/f_g"));
        for (String bad : new String[] {null, "", "root", "Minecraft:x", "minecraft:Story", "minecraft:a b", "minecraft:x\n", "{\"text\":\"x\"}"}) {
            assertNull(ProgressCollector.key(bad), String.valueOf(bad));
        }
        assertNull(ProgressCollector.key("minecraft:" + "a".repeat(ProgressCollector.MAX_KEY_CHARS)));
        assertEquals(
                ProgressCollector.MAX_KEY_CHARS,
                ProgressCollector.key("a:" + "b".repeat(ProgressCollector.MAX_KEY_CHARS - 2)).length());
    }

    @Test
    void guardRefusalAndAThrowingLedgerStopNothing() {
        ProgressCollector c = started("true");
        allowed.set(false);
        c.advancement(LIFE, "minecraft:story/root", true);
        assertTrue(recorded.isEmpty());
        assertEquals(0, begun.get());
        allowed.set(true);
        c.advancement(LIFE, "minecraft:story/root", true);
        assertEquals(1, recorded.size());
    }

    @Test
    void statsAreEmittedPerAgentOnlyAndNeverForAHuman() throws Exception {
        ProgressCollector c = started("true");
        statsFile(AGENT, SAMPLE);
        statsFile(HUMAN, SAMPLE);
        c.join(AGENT, LIFE);
        c.join(HUMAN, "Steve");
        stats.run();
        assertEquals(1, emitted.size());
        String e = emitted.get(0);
        assertTrue(e.startsWith(Names.Events.PLAYER_STATS + "|"), e);
        assertTrue(e.contains(AttrKeys.LIFE_ID + "=" + LIFE), e);
        assertTrue(e.contains(AttrKeys.SUBTYPE + "=deaths"), e);
        assertTrue(e.contains(AttrKeys.AMOUNT + "=3"), e);
        assertFalse(e.contains(AGENT.toString()) || e.contains(HUMAN.toString()) || e.contains("Steve"), e);
    }

    @Test
    void statsNeverRunOnTheMainThreadOrWhenRefused() throws Exception {
        ProgressCollector c = started("true");
        statsFile(AGENT, SAMPLE);
        c.join(AGENT, LIFE);
        main.set(true);
        stats.run();
        main.set(false);
        allowed.set(false);
        stats.run();
        assertTrue(emitted.isEmpty());
    }

    @Test
    void aQuitRemovesTheAgentAndTheRosterIsBounded() throws Exception {
        ProgressCollector c = started("true");
        statsFile(AGENT, SAMPLE);
        c.join(AGENT, LIFE);
        c.quit(AGENT);
        stats.run();
        assertTrue(emitted.isEmpty());
        for (int i = 0; i < ProgressCollector.MAX_AGENTS; i++) {
            c.join(new UUID(9, i), "ag_bot_" + String.format("%02d", i % 100));
        }
        c.join(AGENT, LIFE);
        stats.run();
        assertTrue(emitted.isEmpty(), "full roster admits no new agent");
    }

    @Test
    void stopCancelsTheTaskClearsTheRosterAndSilencesEvents() throws Exception {
        ProgressCollector c = started("true");
        statsFile(AGENT, SAMPLE);
        c.join(AGENT, LIFE);
        Runnable run = stats;
        c.stop();
        c.stop();
        assertEquals(1, cancelled.get());
        run.run();
        c.advancement(LIFE, "minecraft:story/root", true);
        c.join(AGENT, LIFE);
        assertTrue(emitted.isEmpty());
        assertTrue(recorded.isEmpty());
    }

    @Test
    void aMissingStatsDirectoryStartsNoTaskAndThrowsNothing() {
        ProgressCollector c = new ProgressCollector(() -> dir.resolve("nope"), ms -> {});
        c.start(ctx(ledger(config("true"))));
        assertEquals(0, tasks.get());
        c.advancement(LIFE, "minecraft:story/root", true);
        assertEquals(1, recorded.size());
    }

    @Test
    void aThrowingStatsDirSupplierPropagatesOnlyFromStartNotFromEvents() {
        ProgressCollector c = new ProgressCollector(() -> {
            throw new IllegalStateException("x");
        }, ms -> {});
        try {
            c.start(ctx(ledger(config("true"))));
        } catch (IllegalStateException expected) {
            // the wiring catches this and leaves the collector off
        }
        c.advancement(LIFE, "minecraft:story/root", true);
        c.join(AGENT, LIFE);
    }
}
