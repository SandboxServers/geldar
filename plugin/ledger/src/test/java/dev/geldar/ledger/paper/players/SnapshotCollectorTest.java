package dev.geldar.ledger.paper.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.CollectorContext;
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
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.GameMode;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

class SnapshotCollectorTest {
    final List<Player> online = new ArrayList<>();
    final Map<String, Integer> reads = new HashMap<>();
    final List<String> forbidden = new ArrayList<>();
    final AtomicLong clock = new AtomicLong();
    final long[] perCall = {0};
    final long[] refreshCost = {0};
    final FakeHostInfo host = new FakeHostInfo();
    final RecordingLedger ledger = new RecordingLedger(host, LedgerConfig.defaults());
    final FakeHostScheduler scheduler = new FakeHostScheduler();
    final SessionIds sessions = new SessionIds();
    SnapshotCollector collector;

    SnapshotCollector start() {
        return start(ledger);
    }

    SnapshotCollector start(RecordingLedger l) {
        collector = new SnapshotCollector(
                () -> {
                    clock.addAndGet(refreshCost[0]);
                    return List.copyOf(online);
                },
                () -> clock.addAndGet(perCall[0]),
                sessions);
        collector.start(new CollectorContext() {
            public Ledger ledger() {
                return l;
            }

            public HostScheduler scheduler() {
                return scheduler;
            }

            public HostInfo host() {
                return host;
            }
        });
        return collector;
    }

    /** Throwing on anything but the allowed reads, so an address, inventory or effects read fails and is noted. */
    Player player(String name, UUID id, boolean failHealth) {
        World w = (World) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {World.class}, (p, m, a) -> {
            if (m.getName().equals("getName")) {
                return "world";
            }
            forbidden.add("world." + m.getName());
            throw new IllegalStateException();
        });
        return (Player) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> {
            String n = m.getName();
            switch (n) {
                case "hashCode":
                    return id.hashCode();
                case "equals":
                    return p == a[0];
                case "toString":
                    return "player";
                case "getUniqueId":
                    return id;
                case "getName":
                    reads.merge(name + ".name", 1, Integer::sum);
                    return name;
                case "getWorld":
                    return w;
                case "getX":
                    return -0.5;
                case "getY":
                    return 64.9;
                case "getZ":
                    return 10.2;
                case "getHealth":
                    reads.merge(name, 1, Integer::sum);
                    if (failHealth) {
                        throw new IllegalStateException("boom");
                    }
                    return 18.26;
                case "getFoodLevel":
                    return 17;
                case "getLevel":
                    return 3;
                case "getGameMode":
                    return GameMode.SURVIVAL;
                case "getPing":
                    return 120;
                default:
                    forbidden.add(n);
                    throw new IllegalStateException("unexpected player call " + n);
            }
        });
    }

    Player agent(int i) {
        return player("ag_ada_" + String.format("%02d", i), new UUID(0, i + 1), false);
    }

    /** Runs n main-thread ticks; returns the largest number of snapshots read in one tick. */
    int ticks(int n, String prefix) {
        int max = 0;
        for (int i = 0; i < n; i++) {
            int before = total(prefix);
            host.mainThread(true);
            scheduler.advanceTicks(1);
            max = Math.max(max, total(prefix) - before);
        }
        host.mainThread(false);
        return max;
    }

    int total(String prefix) {
        int t = 0;
        for (Map.Entry<String, Integer> e : reads.entrySet()) {
            if (e.getKey().startsWith(prefix) && !e.getKey().endsWith(".name")) {
                t += e.getValue();
            }
        }
        return t;
    }

    void drain() {
        host.mainThread(false);
        scheduler.advanceMillis(SnapshotCollector.DRAIN_MS);
    }

    List<EventRecord> snaps() {
        return ledger.events(Names.Events.PLAYER_SNAPSHOT);
    }

    long countFor(String life) {
        return snaps().stream().filter(e -> life.equals(e.attrs().get(AttrKeys.LIFE_ID))).count();
    }

    @Test
    void nineteenAgentsAreEachSnapshottedOncePer60sNeverMoreThanTwoPerTick() {
        for (int i = 0; i < 19; i++) {
            online.add(agent(i));
        }
        start();
        int max = 0;
        for (int t = 0; t < 1200; t += 20) {
            max = Math.max(max, ticks(20, "ag_"));
            drain();
        }
        assertEquals(2, max);
        for (int i = 0; i < 19; i++) {
            assertEquals(1, countFor("ag_ada_" + String.format("%02d", i)), "agent " + i);
        }
        ticks(40, "ag_");
        drain();
        assertEquals(38, snaps().size());
    }

    /** Counts the INFO notices of the collector logger that mention the roster overflow. */
    private static int overflowNotices(Runnable body) {
        java.util.logging.Logger log = SnapshotCollector.LOG;
        int[] n = {0};
        java.util.logging.Handler h = new java.util.logging.Handler() {
            @Override
            public void publish(java.util.logging.LogRecord r) {
                if (r.getMessage().contains("roster overflow") && r.getLevel() == java.util.logging.Level.INFO) {
                    n[0]++;
                }
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        };
        log.addHandler(h);
        try {
            body.run();
        } finally {
            log.removeHandler(h);
        }
        return n[0];
    }

    @Test
    void playersBeyondTheRosterAreCountedAndLoggedOncePerStart() {
        for (int i = 0; i < SnapshotCollector.MAX_TRACKED + 3; i++) {
            online.add(agent(i));
        }
        int notices = overflowNotices(() -> {
            start();
            ticks(SnapshotCollector.REFRESH_TICKS * 2 + 1, "ag_"); // three refreshes
        });
        assertEquals(3, collector.overflow());
        assertEquals(1, notices);
    }

    @Test
    void aFullRosterIsNotAnOverflow() {
        for (int i = 0; i < SnapshotCollector.MAX_TRACKED; i++) {
            online.add(agent(i));
        }
        int notices = overflowNotices(() -> {
            start();
            ticks(2, "ag_");
        });
        assertEquals(0, collector.overflow());
        assertEquals(0, notices);
    }

    @Test
    void theBudgetClockStartsBeforeTheRosterRefresh() {
        for (int i = 0; i < 3; i++) {
            online.add(agent(i));
        }
        refreshCost[0] = SnapshotCollector.BUDGET_NANOS; // the refresh alone uses the whole budget
        start();
        // all three are due on the refresh tick; the first capture finds the budget spent and the run stops
        assertEquals(1, ticks(1, "ag_"));
    }

    @Test
    void aPlayerJoiningMidCycleIsSnapshottedWithin60s() {
        for (int i = 0; i < 3; i++) {
            online.add(agent(i));
        }
        start();
        ticks(600, "ag_");
        online.add(agent(9));
        ticks(SnapshotCollector.REFRESH_TICKS + 2, "ag_");
        drain();
        assertEquals(1, countFor("ag_ada_09"));
    }

    @Test
    void theMainThreadPartNeverCallsEmitMap() {
        for (int i = 0; i < 5; i++) {
            online.add(agent(i));
        }
        start();
        ticks(60, "ag_");
        assertEquals(List.of(), ledger.mainThreadViolations());
        assertTrue(snaps().isEmpty(), "nothing is emitted before the async drain");
        host.mainThread(true);
        collector.drain();
        assertTrue(snaps().isEmpty(), "a drain on the main thread emits nothing");
        assertEquals(List.of(), ledger.mainThreadViolations());
        drain();
        assertEquals(5, snaps().size());
    }

    @Test
    void exportsOnlyTheCardFieldsAndNoIdentityBeyondTheLifeId() {
        Player a = agent(1);
        online.add(a);
        sessions.open(new UUID(0, 2), 5);
        String session = sessions.get(new UUID(0, 2));
        start();
        ticks(5, "ag_");
        drain();
        assertEquals(List.of(), forbidden);
        assertEquals(List.of(), ledger.rejectedEventKeys());
        Map<String, Object> m = snaps().get(0).attrs();
        assertEquals(
                Set.of(
                        AttrKeys.LIFE_ID, AttrKeys.WORLD, AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.HEALTH,
                        AttrKeys.FOOD, AttrKeys.XP_LEVEL, AttrKeys.GAMEMODE, AttrKeys.PING_BUCKET,
                        AttrKeys.MC_SESSION),
                m.keySet());
        assertEquals("ag_ada_01", m.get(AttrKeys.LIFE_ID));
        assertEquals(session, m.get(AttrKeys.MC_SESSION));
        assertEquals("world", m.get(AttrKeys.WORLD));
        assertEquals(-1L, m.get(AttrKeys.X));
        assertEquals(64L, m.get(AttrKeys.Y));
        assertEquals(10L, m.get(AttrKeys.Z));
        assertEquals(18.3, m.get(AttrKeys.HEALTH));
        assertEquals(17L, m.get(AttrKeys.FOOD));
        assertEquals(3L, m.get(AttrKeys.XP_LEVEL));
        assertEquals("SURVIVAL", m.get(AttrKeys.GAMEMODE));
        assertEquals(200L, m.get(AttrKeys.PING_BUCKET));
        assertFalse(m.toString().contains(new UUID(0, 2).toString()));
    }

    @Test
    void aHumanIsNeverExportedAndOnlyItsNameIsRead() {
        online.add(player("Notch", new UUID(1, 1), false));
        online.add(agent(1));
        start();
        ticks(30, "");
        drain();
        assertEquals(1, snaps().size());
        assertEquals("ag_ada_01", snaps().get(0).attrs().get(AttrKeys.LIFE_ID));
        assertEquals(0, reads.getOrDefault("Notch", 0));
        assertEquals(List.of(), forbidden);
        assertFalse(snaps().toString().contains("Notch"));
    }

    @Test
    void noSessionMeansNoMcSessionAndAConnectionStopNeverBreaksTheSnapshot() {
        online.add(agent(1));
        sessions.open(new UUID(0, 2), 5);
        sessions.clear(); // what ConnectionCollector.stop does to the shared map
        start();
        ticks(5, "ag_");
        drain();
        assertEquals(1, snaps().size());
        assertFalse(snaps().get(0).attrs().containsKey(AttrKeys.MC_SESSION));
    }

    @Test
    void theNoArgCollectorsShareOneSessionMap() {
        assertSame(SessionIds.shared(), new ConnectionCollector().sessions());
        assertSame(SessionIds.shared(), new SnapshotCollector().sessions());
    }

    @Test
    void aSwitchedOffGuardReadsNothingAndAPlayerThatThrowsDoesNotStopTheOthers() {
        online.add(player("ag_bad_01", new UUID(0, 50), true));
        online.add(agent(1));
        RecordingLedger l = ledger;
        start(l);
        l.fakeGuard(SnapshotCollector.ID).disable();
        ticks(30, "ag_");
        assertEquals(0, total("ag_"));
        // a second collector on a fresh ledger with the guard on
        RecordingLedger on = new RecordingLedger(host, LedgerConfig.defaults());
        collector.stop();
        start(on);
        ticks(30, "ag_");
        host.mainThread(false);
        scheduler.advanceMillis(SnapshotCollector.DRAIN_MS);
        assertEquals(1, on.events(Names.Events.PLAYER_SNAPSHOT).size());
        assertEquals(1, reads.get("ag_bad_01"), "the failing player is not retried every tick");
        assertEquals(on.fakeGuard(SnapshotCollector.ID).begins(), on.fakeGuard(SnapshotCollector.ID).ends());
    }

    @Test
    void theTimeBudgetEndsARunAfterOneSnapshot() {
        for (int i = 0; i < 4; i++) {
            online.add(agent(i));
        }
        perCall[0] = SnapshotCollector.BUDGET_NANOS;
        start();
        assertEquals(1, ticks(20, "ag_"));
        assertEquals(4, total("ag_"));
    }

    @Test
    void aFullRingDropsAndNeverThrows() {
        for (int i = 0; i < 100; i++) {
            online.add(agent(i));
        }
        start();
        ticks(100, "ag_");
        assertTrue(collector.dropped() > 0);
        drain();
        assertEquals(SnapshotCollector.RING, snaps().size());
    }

    @Test
    void aConfigThatSwitchesTheCollectorOffSchedulesNothing() {
        online.add(agent(1));
        RecordingLedger off = new RecordingLedger(host, LedgerConfig.disabled());
        start(off);
        assertEquals(0, scheduler.activeTasks());
        collector = null;
    }

    @Test
    void stopCancelsBothTasks() {
        start();
        assertEquals(2, scheduler.activeTasks());
        collector.stop();
        assertEquals(0, scheduler.activeTasks());
    }

    @Test
    void quantizers() {
        assertEquals(-1, SnapshotCollector.pingBucket(-5));
        assertEquals(50, SnapshotCollector.pingBucket(0));
        assertEquals(50, SnapshotCollector.pingBucket(50));
        assertEquals(100, SnapshotCollector.pingBucket(51));
        assertEquals(200, SnapshotCollector.pingBucket(200));
        assertEquals(500, SnapshotCollector.pingBucket(201));
        assertEquals(500, SnapshotCollector.pingBucket(500));
        assertEquals(1000, SnapshotCollector.pingBucket(501));
        assertEquals(1000, SnapshotCollector.pingBucket(60000));
        assertEquals(-1, SnapshotCollector.blockOf(-0.5));
        assertEquals(-2, SnapshotCollector.blockOf(-1.01));
        assertEquals(3, SnapshotCollector.blockOf(3.99));
        assertEquals(19.4, SnapshotCollector.roundHealth(19.44));
        assertEquals(0.0, SnapshotCollector.roundHealth(0.04));
    }
}
