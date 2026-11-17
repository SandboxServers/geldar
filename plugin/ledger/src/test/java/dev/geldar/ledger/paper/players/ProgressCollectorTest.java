package dev.geldar.ledger.paper.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
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
import dev.geldar.ledger.core.RecordingLedger.EventRecord;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.NamespacedKey;
import org.bukkit.advancement.Advancement;
import org.bukkit.entity.Player;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProgressCollectorTest {
    @TempDir
    Path dir;

    final FakeHostInfo host = new FakeHostInfo();
    final RecordingLedger ledger = new RecordingLedger(host, config("true"));
    final FakeHostScheduler scheduler = new FakeHostScheduler();
    final SessionIds sessions = new SessionIds();
    final List<Listener> registered = new ArrayList<>();
    final List<Player> online = new ArrayList<>();
    ProgressCollector collector;

    static LedgerConfig config(String progress) {
        Properties p = new Properties();
        if (progress != null) {
            p.setProperty("collector.progress.enabled", progress);
        }
        return ConfigParser.parse(p).config();
    }

    void start() {
        start(ledger);
    }

    void start(RecordingLedger led) {
        collector = new ProgressCollector(registered::add, () -> List.copyOf(online), () -> dir, sessions, ms -> {});
        collector.start(new CollectorContext() {
            public Ledger ledger() {
                return led;
            }

            public HostScheduler scheduler() {
                return scheduler;
            }

            public HostInfo host() {
                return host;
            }
        });
    }

    ProgressCollector.Handlers handlers() {
        return (ProgressCollector.Handlers) registered.get(0);
    }

    static Player player(String name, UUID id) {
        return (Player) Proxy.newProxyInstance(ProgressCollectorTest.class.getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "getName":
                    return name;
                case "getUniqueId":
                    return id;
                case "hashCode":
                    return id.hashCode();
                case "equals":
                    return p == a[0];
                case "toString":
                    return "player";
                default:
                    throw new IllegalStateException("unexpected player call " + m.getName());
            }
        });
    }

    static Advancement advancement(String key) {
        NamespacedKey k = NamespacedKey.fromString(key);
        return (Advancement) Proxy.newProxyInstance(ProgressCollectorTest.class.getClassLoader(), new Class<?>[] {Advancement.class}, (p, m, a) -> {
            if (m.getName().equals("getKey")) {
                return k;
            }
            throw new IllegalStateException("unexpected advancement call " + m.getName());
        });
    }

    static PlayerAdvancementDoneEvent done(Player p, String key) {
        return new PlayerAdvancementDoneEvent(p, advancement(key), Component.text("display text"));
    }

    void statsFile(UUID id, long playTime) throws Exception {
        Files.writeString(dir.resolve(id + ".json"), "{\"stats\":{\"minecraft:custom\":{\"minecraft:play_time\":" + playTime + ",\"minecraft:jump\":4}}}");
    }

    void tickStats() {
        host.mainThread(false);
        scheduler.advanceMillis(ProgressCollector.STATS_MS);
    }

    @Test
    void offUnlessExplicitlyEnabled() {
        for (String v : new String[] {null, "false"}) {
            registered.clear();
            start(new RecordingLedger(host, config(v)));
            assertEquals(0, registered.size(), "listener, enabled=" + v);
            assertEquals(0, scheduler.activeTasks(), "task, enabled=" + v);
        }
        start(new RecordingLedger(host, config("true")));
        assertEquals(1, registered.size());
        assertEquals(1, scheduler.activeTasks());
    }

    @Test
    void anAgentAdvancementIsRecordedWithItsNamespacedKeyAndSession() {
        start();
        UUID id = new UUID(0, 1);
        String session = sessions.open(id, 0);
        handlers().onAdvancement(done(player("ag_ada_01", id), "minecraft:story/mine_stone"));
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_ADVANCEMENT);
        assertEquals(1, evs.size());
        assertEquals("ag_ada_01", evs.get(0).s1());
        assertEquals("minecraft:story/mine_stone", evs.get(0).s2());
        assertEquals(session, evs.get(0).s3());
        assertFalse(evs.get(0).toString().contains("display text"));
    }

    @Test
    void aHumanAdvancementIsDroppedWholly() {
        start();
        handlers().onAdvancement(done(player("Steve", new UUID(0, 2)), "minecraft:story/root"));
        assertEquals(0, ledger.events(Names.Events.PLAYER_ADVANCEMENT).size());
    }

    @Test
    void onlyShortNamespacedIdsPassTheKeyCheck() {
        assertEquals("minecraft:story/root", ProgressCollector.key("minecraft:story/root"));
        assertEquals("a:" + "b".repeat(94), ProgressCollector.key("a:" + "b".repeat(94)));
        assertNull(ProgressCollector.key("a:" + "b".repeat(95)));
        assertNull(ProgressCollector.key("You got the Stone Age!"));
        assertNull(ProgressCollector.key("minecraft:Story"));
        assertNull(ProgressCollector.key("no_namespace"));
        assertNull(ProgressCollector.key("a:b c"));
        assertNull(ProgressCollector.key(""));
        assertNull(ProgressCollector.key(null));
    }

    @Test
    void anOverlongKeyIsDroppedByTheHandler() {
        start();
        handlers().onAdvancement(done(player("ag_ada_01", new UUID(0, 1)), "minecraft:" + "x".repeat(90)));
        assertEquals(0, ledger.events(Names.Events.PLAYER_ADVANCEMENT).size());
    }

    @Test
    void aThrowingEventNeverEscapesAHandler() {
        start();
        Player bad = player("ag_ada_01", new UUID(0, 1));
        PlayerAdvancementDoneEvent e = new PlayerAdvancementDoneEvent(bad, null, Component.empty());
        handlers().onAdvancement(e);
        handlers().onJoin(new PlayerJoinEvent(null, Component.empty()));
        handlers().onQuit(new PlayerQuitEvent(null, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        assertEquals(0, ledger.events(Names.Events.PLAYER_ADVANCEMENT).size());
    }

    @Test
    void statsAreEmittedForAgentsOnlyAndCarryNoUuid() throws Exception {
        start();
        UUID agent = new UUID(0, 1);
        UUID human = new UUID(0, 2);
        statsFile(agent, 600);
        statsFile(human, 999);
        handlers().onJoin(new PlayerJoinEvent(player("ag_ada_01", agent), Component.empty()));
        handlers().onJoin(new PlayerJoinEvent(player("Steve", human), Component.empty()));
        tickStats();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_STATS);
        assertEquals(1, evs.size());
        assertEquals("ag_ada_01", evs.get(0).attrs().get(AttrKeys.LIFE_ID));
        assertEquals("play_time", evs.get(0).attrs().get(AttrKeys.SUBTYPE));
        assertEquals(600L, ((Number) evs.get(0).attrs().get(AttrKeys.AMOUNT)).longValue());
        String all = evs.toString();
        assertFalse(all.contains(agent.toString()) || all.contains(human.toString()) || all.contains("999") || all.contains("jump"));
        assertFalse(evs.get(0).attrs().containsKey(AttrKeys.PLAYER_UUID));
    }

    @Test
    void agentsAlreadyOnlineAtStartAreReadAndAQuitStopsTheReads() throws Exception {
        UUID agent = new UUID(0, 1);
        statsFile(agent, 5);
        Player p = player("ag_ada_01", agent);
        online.add(p);
        start();
        tickStats();
        assertEquals(1, ledger.events(Names.Events.PLAYER_STATS).size());
        handlers().onQuit(new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        tickStats();
        assertEquals(1, ledger.events(Names.Events.PLAYER_STATS).size());
    }

    @Test
    void theReaderNeverRunsOnTheMainThread() throws Exception {
        UUID agent = new UUID(0, 1);
        statsFile(agent, 5);
        online.add(player("ag_ada_01", agent));
        start();
        host.mainThread(true);
        scheduler.advanceMillis(ProgressCollector.STATS_MS);
        assertEquals(0, ledger.events(Names.Events.PLAYER_STATS).size());
        assertTrue(ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void aTruncatedFileIsSkippedAndTheNextAgentStillReads() throws Exception {
        UUID a = new UUID(0, 1);
        UUID b = new UUID(0, 3);
        Files.writeString(dir.resolve(a + ".json"), "{\"stats\":{\"minecraft:cus");
        statsFile(b, 8);
        online.add(player("ag_ada_01", a));
        online.add(player("ag_bob_02", b));
        start();
        tickStats();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_STATS);
        assertEquals(1, evs.size());
        assertEquals("ag_bob_02", evs.get(0).attrs().get(AttrKeys.LIFE_ID));
    }

    @Test
    void stopCancelsTheTaskAndUnregisters() {
        start();
        assertEquals(1, scheduler.activeTasks());
        collector.stop();
        assertEquals(0, scheduler.activeTasks());
    }

    @Test
    void aMissingStatsDirectoryStillRecordsAdvancements() {
        collector = new ProgressCollector(registered::add, () -> List.of(), () -> dir.resolve("none"), sessions, ms -> {});
        collector.start(new CollectorContext() {
            public Ledger ledger() {
                return ledger;
            }

            public HostScheduler scheduler() {
                return scheduler;
            }

            public HostInfo host() {
                return host;
            }
        });
        assertEquals(0, scheduler.activeTasks());
        handlers().onAdvancement(done(player("ag_ada_01", new UUID(0, 1)), "minecraft:story/root"));
        assertEquals(1, ledger.events(Names.Events.PLAYER_ADVANCEMENT).size());
    }
}
