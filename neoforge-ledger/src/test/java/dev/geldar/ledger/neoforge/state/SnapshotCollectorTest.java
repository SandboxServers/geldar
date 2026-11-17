package dev.geldar.ledger.neoforge.state;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.neoforge.players.SnapshotCollector;
import dev.geldar.ledger.neoforge.players.SnapshotCollector.Reading;
import dev.geldar.ledger.neoforge.players.SnapshotCollector.Ref;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class SnapshotCollectorTest {
    static final String OPT_IN = "collector.snapshot.enabled=true";
    final AtomicInteger humanReads = new AtomicInteger();
    final AtomicInteger agentReads = new AtomicInteger();
    final List<Ref> roster = new ArrayList<>();

    Ref agent(String name) {
        return new Ref() {
            public String name() {
                return name;
            }

            public Reading read() {
                agentReads.incrementAndGet();
                return new Reading("minecraft:overworld", -1, 64, 3, 19.96, 18, 5, "survival");
            }
        };
    }

    Ref human() {
        return new Ref() {
            public String name() {
                return "RealHumanName";
            }

            public Reading read() {
                humanReads.incrementAndGet();
                return new Reading("minecraft:overworld", 0, 0, 0, 20, 20, 0, "survival");
            }
        };
    }

    SnapshotCollector make() {
        return new SnapshotCollector(() -> roster);
    }

    /** Runs the main-thread sampler once. */
    void sample(FakeRig r) {
        r.runAll(true);
    }

    @Test
    void offByDefaultAndWhenMasterOffOrExplicitlyFalse() {
        for (String[] lines : new String[][] {{}, {"collector.snapshot.enabled=false"}, {OPT_IN, "enabled=false"}}) {
            FakeRig r = new FakeRig(lines);
            make().start(r.ctx());
            assertTrue(r.tasks.isEmpty(), String.join(",", lines));
        }
        FakeRig on = new FakeRig(OPT_IN);
        make().start(on.ctx());
        assertEquals(2, on.tasks.size());
    }

    @Test
    void emitsAgentsOnlyWithLifeIdAndNoHumanFieldRead() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(agent("ag_ada_01"));
        roster.add(human());
        make().start(r.ctx());
        sample(r);
        r.runAll(false);
        assertEquals(0, humanReads.get());
        assertEquals(1, r.events.size());
        assertEquals(Names.Events.PLAYER_SNAPSHOT, r.events.get(0));
        Map<?, ?> a = r.eventAttrs.get(0);
        assertEquals("ag_ada_01", a.get(AttrKeys.LIFE_ID));
        assertEquals(-1L, a.get(AttrKeys.X));
        assertEquals(20.0, a.get(AttrKeys.HEALTH));
        assertEquals("survival", a.get(AttrKeys.GAMEMODE));
        assertNull(a.get(AttrKeys.MC_SESSION));
        assertNull(a.get(AttrKeys.PLAYER_UUID));
        assertFalse(a.toString().contains("RealHuman"));
    }

    @Test
    void oneSnapshotPerAgentPerSixtySeconds() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(agent("ag_ada_01"));
        make().start(r.ctx());
        for (int i = 0; i < SnapshotCollector.INTERVAL_RUNS; i++) {
            sample(r);
        }
        assertEquals(1, agentReads.get());
        sample(r);
        assertEquals(2, agentReads.get());
    }

    @Test
    void perRunCapAndRoundRobin() {
        FakeRig r = new FakeRig(OPT_IN);
        for (int i = 0; i < 20; i++) {
            roster.add(agent("ag_a" + i + "_01"));
        }
        make().start(r.ctx());
        sample(r);
        assertEquals(SnapshotCollector.MAX_PER_RUN, agentReads.get());
        sample(r);
        sample(r);
        assertEquals(20, agentReads.get());
    }

    @Test
    void fullQueueDropsAndNeverGrowsPastTheCap() {
        FakeRig r = new FakeRig(OPT_IN);
        for (int i = 0; i < 200; i++) {
            roster.add(agent("ag_a" + i + "_01"));
        }
        SnapshotCollector c = make();
        c.start(r.ctx());
        for (int i = 0; i < 40; i++) {
            sample(r); // no drain: the queue fills
        }
        assertTrue(c.dropped() > 0);
        r.runAll(false);
        assertEquals(64, r.events.size());
    }

    @Test
    void drainRunsAsyncOnlyAndGuardIsMainOnly() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(agent("ag_ada_01"));
        make().start(r.ctx());
        sample(r);
        r.tasks.stream().filter(t -> !t.main).forEach(t -> t.body.run()); // on the main thread: nothing
        assertTrue(r.events.isEmpty());
        r.runAll(false);
        assertEquals(1, r.events.size());
        assertEquals(1, r.begins.get());
        assertEquals(1, r.ends.get());
        assertEquals(0, r.guardOffMain.get());
    }

    @Test
    void paperSpellingOptsInToo() {
        FakeRig r = new FakeRig("collector.snapshots.enabled=true");
        make().start(r.ctx());
        assertEquals(2, r.tasks.size());
        FakeRig off = new FakeRig("collector.snapshots.enabled=true", "enabled=false");
        make().start(off.ctx());
        assertTrue(off.tasks.isEmpty());
        FakeRig no = new FakeRig("collector.snapshots.enabled=false");
        make().start(no.ctx());
        assertTrue(no.tasks.isEmpty());
    }

    @Test
    void vmErrorsFromAReadOrTheEmitAreNotSwallowed() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(new Ref() {
            public String name() {
                return "ag_oom_01";
            }

            public Reading read() {
                throw new OutOfMemoryError();
            }
        });
        make().start(r.ctx());
        org.junit.jupiter.api.Assertions.assertThrows(OutOfMemoryError.class, () -> sample(r));
        FakeRig r2 = new FakeRig(OPT_IN);
        roster.clear();
        roster.add(new Ref() {
            public String name() {
                throw new OutOfMemoryError();
            }

            public Reading read() {
                return null;
            }
        });
        make().start(r2.ctx());
        org.junit.jupiter.api.Assertions.assertThrows(OutOfMemoryError.class, () -> sample(r2));
    }

    @Test
    void trackedAgentsAreCountedOnceAndCapped() {
        FakeRig r = new FakeRig(OPT_IN);
        java.util.Set<String> read = new java.util.HashSet<>();
        for (int i = 0; i < 600; i++) {
            String n = "ag_t" + i + "_01";
            roster.add(new Ref() {
                public String name() {
                    return n;
                }

                public Reading read() {
                    read.add(n);
                    return new Reading("w", 0, 0, 0, 1, 1, 1, "survival");
                }
            });
        }
        make().start(r.ctx());
        for (int i = 0; i < 200; i++) {
            sample(r);
        }
        // the first MAX_TRACKED agents are all tracked (each counted once); the rest never are
        assertEquals(SnapshotCollector.MAX_TRACKED, read.size());
        assertFalse(read.contains("ag_t599_01"));
    }
    @Test
    void blockCoordFloorsOnBothSigns() {
        assertEquals(-1, SnapshotCollector.blockCoord(-0.5));
        assertEquals(-1, SnapshotCollector.blockCoord(-1.0));
        assertEquals(-2, SnapshotCollector.blockCoord(-1.5));
        assertEquals(0, SnapshotCollector.blockCoord(0.5));
        assertEquals(1, SnapshotCollector.blockCoord(1.5));
        assertEquals(-30000001, SnapshotCollector.blockCoord(-30000000.1));
    }

    @Test
    void guardOffStopsSampling() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(agent("ag_ada_01"));
        make().start(r.ctx());
        r.allowed.set(false);
        sample(r);
        assertEquals(0, agentReads.get());
    }

    @Test
    void aThrowingReadDoesNotStopTheOthersNorRetryEveryRun() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(new Ref() {
            public String name() {
                return "ag_bad_01";
            }

            public Reading read() {
                agentReads.incrementAndGet();
                throw new IllegalStateException();
            }
        });
        roster.add(agent("ag_ada_01"));
        make().start(r.ctx());
        sample(r);
        sample(r);
        assertEquals(1 + 1, agentReads.get());
        r.runAll(false);
        assertEquals(1, r.events.size());
        assertEquals(r.begins.get(), r.ends.get());
    }

    @Test
    void stopThenRestartKeepsTheNewRunsSnapshotsAndDropsTheOld() {
        FakeRig r = new FakeRig(OPT_IN);
        roster.add(agent("ag_ada_01"));
        SnapshotCollector c = make();
        c.start(r.ctx());
        sample(r); // queued in run 1, not drained
        List<FakeRig.Task> oldTasks = new ArrayList<>(r.tasks);
        c.stop();
        assertTrue(oldTasks.stream().allMatch(t -> t.cancelled.get()));
        c.start(r.ctx());
        sample(r); // queued in run 2
        // a late fire of the old run's cancelled tasks must neither emit run 1's item nor consume run 2's
        r.main.set(false);
        oldTasks.stream().filter(t -> !t.main).forEach(t -> t.body.run());
        r.main.set(true);
        assertTrue(r.events.isEmpty());
        r.runAll(false);
        assertEquals(1, r.events.size());
        c.stop();
        sample(r);
        r.runAll(false);
        assertEquals(1, r.events.size());
    }
}