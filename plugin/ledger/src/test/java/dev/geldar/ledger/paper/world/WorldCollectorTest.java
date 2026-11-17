package dev.geldar.ledger.paper.world;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

class WorldCollectorTest {
    private static final Set<String> ALLOWED = Set.of("getName", "getChunkCount", "getEntityCount", "getPlayerCount");

    /** A World that answers only the four count reads and records every method name called on it. */
    private static final class FakeWorld {
        final String name;
        volatile int chunks;
        volatile int entities;
        volatile int players;
        volatile boolean throwing;
        final List<String> calls = new CopyOnWriteArrayList<>();
        final World world;

        FakeWorld(String name, int chunks, int entities, int players) {
            this.name = name;
            this.chunks = chunks;
            this.entities = entities;
            this.players = players;
            this.world = (World) Proxy.newProxyInstance(
                    WorldCollectorTest.class.getClassLoader(), new Class<?>[] {World.class}, (p, m, a) -> {
                        calls.add(m.getName());
                        if (throwing) {
                            throw new IllegalStateException("boom");
                        }
                        return switch (m.getName()) {
                            case "getName" -> this.name;
                            case "getChunkCount" -> this.chunks;
                            case "getEntityCount" -> this.entities;
                            case "getPlayerCount" -> this.players;
                            default -> throw new UnsupportedOperationException(m.getName());
                        };
                    });
        }
    }

    private static final class Rig {
        final List<FakeWorld> worlds = new ArrayList<>();
        final FakeHostInfo host = new FakeHostInfo();
        final RecordingLedger ledger = new RecordingLedger(host, LedgerConfig.defaults());
        final FakeHostScheduler scheduler = new FakeHostScheduler();
        final WorldCollector collector = new WorldCollector(() -> worlds.stream().map(w -> w.world).toList());

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

        /** Runs one sample on the main thread, then one registration pass on an async thread. */
        void round() {
            host.mainThread(true);
            scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
            host.mainThread(false);
            scheduler.advanceMillis(WorldCollector.REGISTER_EVERY_MS);
        }

        long read(String metric, String world) {
            return ledger.readGaugeLong(metric, world);
        }
    }

    @Test
    void twoWorldsYieldTwoSeriesWithTheCountedValues() {
        Rig r = new Rig();
        r.worlds.add(new FakeWorld("world", 100, 40, 3));
        r.worlds.add(new FakeWorld("world_nether", 20, 7, 0));
        r.start().round();
        assertEquals(100, r.read(Names.World.LOADED_CHUNKS, "world"));
        assertEquals(40, r.read(Names.World.ENTITIES, "world"));
        assertEquals(3, r.read(Names.World.PLAYERS, "world"));
        assertEquals(20, r.read(Names.World.LOADED_CHUNKS, "world_nether"));
        assertEquals(7, r.read(Names.World.ENTITIES, "world_nether"));
        assertEquals(0, r.read(Names.World.PLAYERS, "world_nether"));
        assertEquals(2, r.ledger.registrations(Names.World.LOADED_CHUNKS).size());
        assertTrue(r.ledger.rejectedMetricKeys().isEmpty());
    }

    @Test
    void valuesFollowTheWorldOnTheNextSample() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 2, 3);
        r.worlds.add(w);
        r.start().round();
        w.chunks = 11;
        w.entities = 22;
        w.players = 33;
        r.round();
        assertEquals(11, r.read(Names.World.LOADED_CHUNKS, "world"));
        assertEquals(22, r.read(Names.World.ENTITIES, "world"));
        assertEquals(33, r.read(Names.World.PLAYERS, "world"));
    }

    @Test
    void aWorldAddedLaterAddsASeriesWithoutARestart() {
        Rig r = new Rig();
        r.worlds.add(new FakeWorld("world", 5, 5, 5));
        r.start().round();
        assertEquals(1, r.ledger.registrations(Names.World.ENTITIES).size());
        r.worlds.add(new FakeWorld("world_the_end", 9, 8, 7));
        r.round();
        assertEquals(2, r.ledger.registrations(Names.World.ENTITIES).size());
        assertEquals(8, r.read(Names.World.ENTITIES, "world_the_end"));
        r.round();
        assertEquals(2, r.ledger.registrations(Names.World.ENTITIES).size());
    }

    @Test
    void onlyTheThreeCountReadsAndTheNameAreEverCalled() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 1, 1);
        r.worlds.add(w);
        r.start().round();
        assertFalse(w.calls.isEmpty());
        assertTrue(ALLOWED.containsAll(w.calls), "unexpected world calls: " + w.calls);
    }

    @Test
    void sourceNeverNamesTheAllocatingOrChunkLoadingCalls() throws IOException {
        Path src = Path.of("src/main/java/dev/geldar/ledger/paper/world/WorldCollector.java");
        String text = Files.readString(src);
        for (String banned : List.of("getLoadedChunks", "getEntities", "getPlayers", "getChunkAt", "getChunkAtAsync",
                "loadChunk", "getLivingEntities")) {
            assertFalse(text.contains(banned + "("), banned);
        }
    }

    @Test
    void sampleAndRegistrationAreSkippedOnTheWrongThread() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 1, 1);
        r.worlds.add(w);
        r.start();
        r.host.mainThread(false);
        r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        assertTrue(w.calls.isEmpty(), "sample must not read worlds off the main thread");
        r.host.mainThread(true);
        r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        r.scheduler.advanceMillis(WorldCollector.REGISTER_EVERY_MS);
        assertEquals(0, r.ledger.registrations(Names.World.ENTITIES).size(), "no gauge registration on the main thread");
        assertTrue(r.ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void sampleIsGuardedAndSkippedWhenTheGuardIsOff() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 1, 1);
        r.worlds.add(w);
        r.start().round();
        assertEquals(1, r.ledger.fakeGuard(WorldCollector.ID).begins());
        assertEquals(1, r.ledger.fakeGuard(WorldCollector.ID).ends());
        r.ledger.fakeGuard(WorldCollector.ID).disable();
        w.calls.clear();
        r.round();
        assertTrue(w.calls.isEmpty());
        assertEquals(1, r.ledger.fakeGuard(WorldCollector.ID).begins());
    }

    @Test
    void aThrowingWorldIsSwallowedAndTheGuardIsStillClosed() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 1, 1);
        w.throwing = true;
        r.worlds.add(w);
        r.start();
        r.host.mainThread(true);
        r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        assertEquals(r.ledger.fakeGuard(WorldCollector.ID).begins(), r.ledger.fakeGuard(WorldCollector.ID).ends());
        w.throwing = false;
        r.round();
        assertEquals(1, r.read(Names.World.ENTITIES, "world"));
    }

    @Test
    void worldsAreCappedAndOneRunReadsOnlyASlice() {
        Rig r = new Rig();
        for (int i = 0; i < 40; i++) {
            r.worlds.add(new FakeWorld("w" + i, i, i, i));
        }
        r.start();
        r.host.mainThread(true);
        r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        assertEquals(WorldCollector.WORLDS_PER_RUN, r.collector.trackedWorlds().size());
        r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        assertEquals(WorldCollector.MAX_WORLDS, r.collector.trackedWorlds().size());
        for (int i = 0; i < 5; i++) {
            r.scheduler.advanceTicks(LedgerConfig.defaults().sampleWorldEveryTicks());
        }
        assertEquals(WorldCollector.MAX_WORLDS, r.collector.trackedWorlds().size());
        long reads = r.worlds.stream().filter(w -> !w.calls.isEmpty()).count();
        assertEquals(WorldCollector.MAX_WORLDS, reads);
    }

    @Test
    void stopCancelsBothTimersAndIsIdempotent() {
        Rig r = new Rig();
        FakeWorld w = new FakeWorld("world", 1, 1, 1);
        r.worlds.add(w);
        r.start();
        assertEquals(2, r.scheduler.activeTasks());
        r.collector.stop();
        r.collector.stop();
        assertEquals(0, r.scheduler.activeTasks());
        r.collector.sample();
        assertTrue(w.calls.isEmpty());
    }

    @Test
    void theShellBuildsItByReflectionAndByTheNameTheListExpects() throws Exception {
        Class<?> cls = Class.forName("dev.geldar.ledger.paper.world.WorldCollector");
        Collector c = (Collector) cls.getDeclaredConstructor().newInstance();
        assertEquals("world", c.id());
        assertTrue(dev.geldar.ledger.paper.world.WorldCollector.class.getName().equals(cls.getName()));
    }
}
