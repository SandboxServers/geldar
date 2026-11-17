package dev.geldar.ledger.paper.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.Severity;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class ServerCollectorTest {
    private static final class FakeCounts implements ServerCollector.Counts {
        volatile long players = 2;
        final List<String> operatorList = List.of("op-one", "op-two", "op-three");
        volatile long plugins = 5;
        volatile long pending = 9;
        volatile boolean throwing;
        int reads;

        @Override
        public long players() {
            reads++;
            if (throwing) {
                throw new IllegalStateException("boom");
            }
            return players;
        }

        @Override
        public long operators() {
            return operatorList.size();
        }

        @Override
        public long plugins() {
            return plugins;
        }

        @Override
        public long pendingTasks() {
            return pending;
        }
    }

    private static final class Rig {
        final FakeCounts counts = new FakeCounts();
        final FakeHostInfo host = new FakeHostInfo();
        final RecordingLedger ledger = new RecordingLedger(host, LedgerConfig.defaults());
        final FakeHostScheduler scheduler = new FakeHostScheduler();
        final ServerCollector collector =
                new ServerCollector(counts, () -> ConfigSnapshotTest.propertiesWithSecrets());

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

        void sampleOnMain() {
            host.mainThread(true);
            scheduler.advanceTicks(ServerCollector.SAMPLE_EVERY_TICKS);
            host.mainThread(false);
        }

        void snapshotTimer() {
            host.mainThread(false);
            scheduler.advanceMillis(ServerCollector.SNAPSHOT_DELAY_MS);
        }
    }

    @Test
    void theFourGaugesFollowTheCountsAndTheOperatorsCountEqualsTheListSize() {
        Rig r = new Rig();
        r.start().sampleOnMain();
        assertEquals(2, r.ledger.readGaugeLong(Names.Server.PLAYERS_ONLINE));
        assertEquals(r.counts.operatorList.size(), r.ledger.readGaugeLong(Names.Server.OPERATORS_COUNT));
        assertEquals(5, r.ledger.readGaugeLong(Names.Server.PLUGINS_ENABLED));
        assertEquals(9, r.ledger.readGaugeLong(Names.Server.SCHEDULER_PENDING_TASKS));
        r.counts.players = 7;
        r.sampleOnMain();
        assertEquals(7, r.ledger.readGaugeLong(Names.Server.PLAYERS_ONLINE));
        assertTrue(r.ledger.rejectedMetricKeys().isEmpty());
        assertTrue(r.ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void noOperatorOrPlayerNameReachesAnyEventOrMetricAttribute() {
        Rig r = new Rig();
        r.start().sampleOnMain();
        r.snapshotTimer();
        String all = r.ledger.allEvents().toString() + r.ledger.registrations(Names.Server.OPERATORS_COUNT);
        assertFalse(all.contains("op-one"), all);
    }

    @Test
    void theSnapshotIsEmittedOnceAndNeverFromTheMainThread() {
        Rig r = new Rig();
        r.start();
        r.host.mainThread(true);
        r.scheduler.advanceMillis(ServerCollector.SNAPSHOT_DELAY_MS);
        assertEquals(0, r.ledger.events(Names.Events.SERVER_CONFIG_SNAPSHOT).size(), "not on the main thread");
        r.snapshotTimer();
        r.snapshotTimer();
        r.snapshotTimer();
        var events = r.ledger.events(Names.Events.SERVER_CONFIG_SNAPSHOT);
        assertEquals(1, events.size());
        assertEquals(Severity.INFO, events.get(0).severity());
        assertFalse(events.get(0).attrs().toString().contains("hunter2"));
        assertTrue(r.ledger.rejectedEventKeys().isEmpty());
        assertTrue(r.ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void theSnapshotTimerCancelsItselfAfterTheFirstRun() {
        Rig r = new Rig();
        r.start();
        assertEquals(2, r.scheduler.activeTasks());
        r.snapshotTimer();
        assertEquals(1, r.scheduler.activeTasks());
    }

    @Test
    void sampleIsSkippedOffTheMainThreadAndWhenTheGuardIsOff() {
        Rig r = new Rig();
        r.start();
        int before = r.counts.reads;
        r.host.mainThread(false);
        r.scheduler.advanceTicks(ServerCollector.SAMPLE_EVERY_TICKS);
        assertEquals(before, r.counts.reads);
        r.sampleOnMain();
        assertEquals(before + 1, r.counts.reads);
        assertEquals(r.ledger.fakeGuard(ServerCollector.ID).begins(), r.ledger.fakeGuard(ServerCollector.ID).ends());
        r.ledger.fakeGuard(ServerCollector.ID).disable();
        r.sampleOnMain();
        assertEquals(before + 1, r.counts.reads);
    }

    @Test
    void aThrowingReadIsSwallowedAndTheGuardIsStillClosed() {
        Rig r = new Rig();
        r.start();
        r.counts.throwing = true;
        r.sampleOnMain();
        assertEquals(r.ledger.fakeGuard(ServerCollector.ID).begins(), r.ledger.fakeGuard(ServerCollector.ID).ends());
        r.counts.throwing = false;
        r.counts.players = 4;
        r.sampleOnMain();
        assertEquals(4, r.ledger.readGaugeLong(Names.Server.PLAYERS_ONLINE));
    }

    @Test
    void aThrowingSnapshotSourceIsSwallowed() {
        Rig r = new Rig();
        ServerCollector c = new ServerCollector(r.counts, () -> {
            throw new IllegalStateException("no server");
        });
        c.start(new CollectorContext() {
            public Ledger ledger() {
                return r.ledger;
            }

            public HostScheduler scheduler() {
                return r.scheduler;
            }

            public HostInfo host() {
                return r.host;
            }
        });
        r.snapshotTimer();
        assertEquals(0, r.ledger.events(Names.Events.SERVER_CONFIG_SNAPSHOT).size());
    }

    @Test
    void stopCancelsBothTimersAndIsIdempotent() {
        Rig r = new Rig();
        r.start();
        assertEquals(2, r.scheduler.activeTasks());
        r.collector.stop();
        r.collector.stop();
        assertEquals(0, r.scheduler.activeTasks());
        r.host.mainThread(true);
        int reads = r.counts.reads;
        r.collector.sample();
        assertEquals(reads, r.counts.reads);
    }

    @Test
    void theShellBuildsItByReflection() throws Exception {
        Class<?> cls = Class.forName("dev.geldar.ledger.paper.server.ServerCollector");
        assertEquals("server", ((dev.geldar.ledger.core.Collector) cls.getDeclaredConstructor().newInstance()).id());
    }

    @Test
    void sourceNeverNamesAServerPropertiesFileOrASetter() throws IOException {
        for (String f : List.of("ServerCollector.java", "ConfigSnapshot.java")) {
            String text = Files.readString(Path.of("src/main/java/dev/geldar/ledger/paper/server/" + f));
            for (String banned : List.of("Files.", "FileReader", "FileInputStream", "getIp(", "setTickRate", "getPlayer(", "getName(")) {
                assertFalse(text.contains(banned), f + " names " + banned);
            }
        }
    }
}
