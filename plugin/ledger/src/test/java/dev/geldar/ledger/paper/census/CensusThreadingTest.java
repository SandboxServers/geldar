package dev.geldar.ledger.paper.census;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.paper.census.CensusCollectorTest.EvA;
import dev.geldar.ledger.paper.census.CensusCollectorTest.Rig;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The executor's thread rule (guard fields are main-thread-only) and its exact-class rule (disjoint series). */
class CensusThreadingTest {
    /** A child of EvA: it inherits EvA's handler list, as 58 Paper event classes do. */
    static final class EvC extends EvA {}

    /** A plugin-defined subclass that is not on the allow-list. */
    static final class EvD extends EvA {}

    private static final String ENABLE = "collector.census.enabled";
    private static final String LC = "CensusThreadingTest$EvC";

    private static long count(Rig r, String label) {
        return r.ledger.counterValue(Names.Census.EVENT_COUNT_TOTAL, label, "false");
    }

    @Test
    void offThreadEventCountsButNeverTouchesTheGuard() throws Exception {
        Rig r = new Rig(List.of(CensusCollectorTest.A), ENABLE, "true").start();
        r.host.mainThread(false);
        Thread t = new Thread(() -> {
            try {
                r.fire(EvA.class, new EvA());
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        t.start();
        t.join();
        assertEquals(0, r.ledger.fakeGuard("census").begins());
        assertEquals(0, r.ledger.fakeGuard("census").ends());
        assertEquals(1, count(r, CensusCollectorTest.LA));
    }

    @Test
    void mainThreadEventUsesTheGuardAndAnOffGuardStopsIt() throws Exception {
        Rig r = new Rig(List.of(CensusCollectorTest.A), ENABLE, "true").start();
        r.host.mainThread(true);
        r.fire(EvA.class, new EvA());
        assertEquals(1, r.ledger.fakeGuard("census").begins());
        assertEquals(1, r.ledger.fakeGuard("census").ends());
        assertEquals(1, count(r, CensusCollectorTest.LA));
        r.ledger.fakeGuard("census").disable();
        r.fire(EvA.class, new EvA());
        assertEquals(1, count(r, CensusCollectorTest.LA));
    }

    @Test
    void offThreadDutyCycleStillGatesCounting() throws Exception {
        Rig r = new Rig(List.of(CensusCollectorTest.A), ENABLE, "true", "collector.census.duty." + CensusCollectorTest.LA, "5/20")
                .start();
        r.host.mainThread(false);
        for (long tick = 0; tick < 20; tick++) {
            r.host.serverTick(tick);
            r.fire(EvA.class, new EvA());
        }
        assertEquals(5, count(r, CensusCollectorTest.LA));
        assertEquals(0, r.ledger.fakeGuard("census").begins());
    }

    @Test
    void concurrentHammerKeepsTheGuardEnabledAndTheCountExact() throws Exception {
        Rig r = new Rig(List.of(CensusCollectorTest.A), ENABLE, "true").start();
        r.host.mainThread(false);
        int threads = 4;
        int each = 50_000;
        List<Thread> ts = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            Thread t = new Thread(() -> {
                try {
                    for (int n = 0; n < each; n++) {
                        r.fire(EvA.class, new EvA());
                    }
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
            });
            ts.add(t);
            t.start();
        }
        for (Thread t : ts) {
            t.join();
        }
        assertTrue(r.ledger.fakeGuard("census").allowed());
        assertEquals(0, r.ledger.fakeGuard("census").begins());
        assertEquals((long) threads * each, count(r, CensusCollectorTest.LA));
    }

    @Test
    void seriesAreDisjointParentIgnoresChildAndUnlistedSubclassCountsNowhere() throws Exception {
        Rig r = new Rig(List.of(CensusCollectorTest.A, EvC.class.getName()), ENABLE, "true").start();
        // a child event is delivered to the parent's executor too (shared handler list): the parent ignores it
        r.fire(EvA.class, new EvC());
        assertEquals(0, count(r, CensusCollectorTest.LA));
        r.fire(EvC.class, new EvC());
        assertEquals(1, count(r, LC));
        assertEquals(0, count(r, CensusCollectorTest.LA));
        // a plugin subclass of a listed class counts under neither executor
        r.fire(EvA.class, new EvD());
        r.fire(EvC.class, new EvD());
        assertEquals(0, count(r, CensusCollectorTest.LA));
        assertEquals(1, count(r, LC));
        // the parent still counts its own class
        r.fire(EvA.class, new EvA());
        assertEquals(1, count(r, CensusCollectorTest.LA));
    }

    @Test
    void fourMoreHighRateClassesAreDutyCycledByDefault() {
        for (String n : List.of("EntityInsideBlockEvent", "EntityEffectTickEvent", "EntityAddToWorldEvent", "BlockRedstoneEvent")) {
            assertEquals(new LedgerConfig.Duty(5, 20), DefaultDuty.forSimpleName(n), n);
        }
    }
}
