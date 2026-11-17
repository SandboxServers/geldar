package dev.geldar.ledger.neoforge.state;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.neoforge.server.ServerCollector;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class ServerCollectorTest {
    final AtomicLong players = new AtomicLong(2);

    final ServerCollector.Counts counts = new ServerCollector.Counts() {
        public long players() {
            return players.get();
        }

        public long operators() {
            return 1;
        }

        public long mods() {
            return 7;
        }
    };

    static Map<String, String> rawWithSecrets() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("server_version", "26.1.2");
        m.put("max_players", "20");
        m.put("rcon.password", "hunter2");
        m.put("rcon_port", "25575");
        m.put("query_port", "25565");
        m.put("server-ip", "server-ip-value");
        m.put("level-seed", "12345");
        m.put("jvm_xmx", "4G");
        return m;
    }

    @Test
    void gaugesReadSampledCountsAndSnapshotEmitsOnceAllowListed() {
        FakeRig r = new FakeRig();
        ServerCollector c = new ServerCollector(counts, ServerCollectorTest::rawWithSecrets);
        c.start(r.ctx());
        assertEquals(2, r.gauges.get(Names.Server.PLAYERS_ONLINE + "[]").getAsLong());
        assertEquals(1, r.gauges.get(Names.Server.OPERATORS_COUNT + "[]").getAsLong());
        assertEquals(7, r.gauges.get(Names.Server.MODS_LOADED + "[]").getAsLong());
        assertFalse(r.gauges.containsKey(Names.Server.PLUGINS_ENABLED + "[]"));
        players.set(5);
        r.runAll(true);
        assertEquals(5, r.gauges.get(Names.Server.PLAYERS_ONLINE + "[]").getAsLong());
        assertTrue(r.begins.get() >= 1);
        assertEquals(r.begins.get(), r.ends.get());
        assertEquals(0, r.guardOffMain.get());

        r.runAll(false);
        r.runAll(false);
        assertEquals(1, r.events.size());
        assertEquals(Names.Events.SERVER_CONFIG_SNAPSHOT, r.events.get(0));
        Map<?, ?> a = r.eventAttrs.get(0);
        assertEquals("server", a.get(AttrKeys.COLLECTOR));
        assertEquals("server_version=26.1.2; max_players=20; jvm_xmx=4G", a.get(AttrKeys.TEXT));
        String all = a.toString();
        for (String bad : new String[] {"hunter2", "25575", "server-ip-value", "12345", "rcon", "seed"}) {
            assertFalse(all.contains(bad), bad);
        }
        assertTrue(r.tasks.stream().filter(t -> !t.main).allMatch(t -> t.cancelled.get()));
    }

    @Test
    void snapshotNeverEmitsOnTheMainThreadOrAfterStop() {
        FakeRig r = new FakeRig();
        ServerCollector c = new ServerCollector(counts, ServerCollectorTest::rawWithSecrets);
        c.start(r.ctx());
        r.runAll(true); // an async task invoked on the main thread does nothing: run it with the flag still main
        r.tasks.stream().filter(t -> !t.main).forEach(t -> t.body.run());
        assertTrue(r.events.isEmpty());
        c.stop();
        r.runAll(false);
        assertTrue(r.events.isEmpty());
        // a late fire of the cancelled async task (it was already running when stop() came) must not emit
        r.main.set(false);
        r.tasks.stream().filter(t -> !t.main).forEach(t -> t.body.run());
        r.main.set(true);
        assertTrue(r.events.isEmpty());
    }

    @Test
    void guardOffStopsSamplingAndAThrowingCountNeverEscapes() {
        FakeRig r = new FakeRig();
        ServerCollector c = new ServerCollector(counts, ServerCollectorTest::rawWithSecrets);
        c.start(r.ctx());
        r.allowed.set(false);
        players.set(9);
        r.runAll(true);
        assertEquals(2, r.gauges.get(Names.Server.PLAYERS_ONLINE + "[]").getAsLong());
        FakeRig r2 = new FakeRig();
        ServerCollector bad = new ServerCollector(new ServerCollector.Counts() {
            public long players() {
                throw new IllegalStateException();
            }

            public long operators() {
                return 0;
            }

            public long mods() {
                return 0;
            }
        }, () -> {
            throw new IllegalStateException();
        });
        bad.start(r2.ctx());
        r2.runAll(true);
        r2.runAll(false);
        assertTrue(r2.events.isEmpty());
        assertEquals(r2.begins.get(), r2.ends.get());
    }

    @Test
    void aVmErrorFromACountOrTheSnapshotSourceIsNotSwallowed() {
        ServerCollector.Counts oom = new ServerCollector.Counts() {
            public long players() {
                throw new OutOfMemoryError();
            }

            public long operators() {
                return 0;
            }

            public long mods() {
                return 0;
            }
        };
        FakeRig r = new FakeRig();
        org.junit.jupiter.api.Assertions.assertThrows(OutOfMemoryError.class, () -> new ServerCollector(oom, Map::of).start(r.ctx()));
        FakeRig r2 = new FakeRig();
        org.junit.jupiter.api.Assertions.assertThrows(
                OutOfMemoryError.class,
                () -> new ServerCollector(counts, () -> {
                            throw new OutOfMemoryError();
                        })
                        .start(r2.ctx()));
    }

    @Test
    void offWhenCollectorOrMasterDisabled() {
        for (String line : new String[] {"collector.server.enabled=false", "enabled=false"}) {
            FakeRig r = new FakeRig(line);
            new ServerCollector(counts, ServerCollectorTest::rawWithSecrets).start(r.ctx());
            assertTrue(r.gauges.isEmpty(), line);
            assertTrue(r.tasks.isEmpty(), line);
        }
    }

    @Test
    void restartEmitsTheSnapshotAgain() {
        FakeRig r = new FakeRig();
        ServerCollector c = new ServerCollector(counts, ServerCollectorTest::rawWithSecrets);
        c.start(r.ctx());
        r.runAll(false);
        c.start(r.ctx());
        r.runAll(false);
        assertEquals(2, r.events.size());
    }
}