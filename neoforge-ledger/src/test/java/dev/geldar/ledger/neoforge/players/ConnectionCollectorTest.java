package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.neoforge.state.FakeRig;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class ConnectionCollectorTest {
    final AtomicLong now = new AtomicLong(1_000);
    final AtomicInteger seq = new AtomicInteger();
    final SessionIds sessions = new SessionIds(8, () -> "S" + seq.incrementAndGet());

    ConnectionCollector started(FakeRig r) {
        ConnectionCollector c = new ConnectionCollector(now::get, sessions);
        c.start(r.ctx());
        return c;
    }

    @Test
    void agentJoinOpensSessionAndQuitClosesItWithDuration() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        Object p = new Object();
        c.join(p, "ag_ada_01", 3);
        now.set(4_500);
        c.quit(p, "ag_ada_01");
        assertEquals(Names.Events.PLAYER_JOIN, r.events.get(0));
        Map<?, ?> j = r.eventAttrs.get(0);
        assertEquals("ag_ada_01", j.get(AttrKeys.LIFE_ID));
        assertEquals("S1", j.get(AttrKeys.MC_SESSION));
        assertEquals(3L, j.get(AttrKeys.AMOUNT));
        assertEquals(Names.Events.PLAYER_QUIT, r.events.get(1));
        Map<?, ?> q = r.eventAttrs.get(1);
        assertEquals("S1", q.get(AttrKeys.MC_SESSION));
        assertEquals(3_500L, q.get(AttrKeys.DURATION_MS));
        assertEquals(0, sessions.size());
        assertEquals(2, r.begins.get());
        assertEquals(2, r.ends.get());
    }

    @Test
    void reconnectGetsAFreshSessionAndAStaleQuitNeverClosesTheNewOne() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        Object oldP = new Object();
        Object newP = new Object();
        c.join(oldP, "ag_ada_01", 1);
        c.join(newP, "ag_ada_01", 1); // reconnect before the old quit arrives
        assertNotEquals(r.eventAttrs.get(0).get(AttrKeys.MC_SESSION), r.eventAttrs.get(1).get(AttrKeys.MC_SESSION));
        c.quit(oldP, "ag_ada_01");
        assertEquals("S2", sessions.get(newP));
        assertEquals("S1", r.eventAttrs.get(2).get(AttrKeys.MC_SESSION));
        c.quit(newP, "ag_ada_01");
        assertEquals("S2", r.eventAttrs.get(3).get(AttrKeys.MC_SESSION));
        assertEquals(0, sessions.size());
    }

    @Test
    void humanGetsNoLifeIdNoSessionNoName() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        Object p = new Object();
        c.join(p, "RealHumanName", 2);
        c.quit(p, "RealHumanName");
        assertEquals(2, r.events.size());
        for (Map<?, ?> a : r.eventAttrs) {
            assertNull(a.get(AttrKeys.LIFE_ID));
            assertNull(a.get(AttrKeys.MC_SESSION));
            assertNull(a.get(AttrKeys.PLAYER_UUID));
            assertFalse(a.toString().contains("RealHuman"));
        }
        assertEquals(2L, r.eventAttrs.get(0).get(AttrKeys.AMOUNT));
        assertEquals(0, sessions.size());
    }

    @Test
    void lifeIdLookalikeOfWrongShapeIsAHuman() {
        assertNull(ConnectionCollector.lifeId("ag_Ada_01"));
        assertNull(ConnectionCollector.lifeId(null));
        assertEquals("ag_ada_01", ConnectionCollector.lifeId("ag_ada_01"));
    }

    @Test
    void offByMasterOrCollectorFlagEmitsNothing() {
        for (String[] lines : new String[][] {{"enabled=false"}, {"collector.connections.enabled=false"}}) {
            FakeRig r = new FakeRig(lines);
            ConnectionCollector c = started(r);
            Object p = new Object();
            c.join(p, "ag_ada_01", 1);
            c.quit(p, "ag_ada_01");
            assertTrue(r.events.isEmpty(), String.join(",", lines));
            assertEquals(0, sessions.size());
        }
    }

    @Test
    void guardOffEmitsNothingButQuitStillReleasesTheSession() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        Object p = new Object();
        c.join(p, "ag_ada_01", 1);
        r.allowed.set(false);
        c.quit(p, "ag_ada_01");
        assertEquals(1, r.events.size());
        assertEquals(0, sessions.size());
        c.join(new Object(), "ag_bob_01", 1);
        assertEquals(1, r.events.size());
        assertEquals(0, sessions.size());
    }

    @Test
    void stopClearsSessionsAndLaterEventsAreIgnored() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        Object p = new Object();
        c.join(p, "ag_ada_01", 1);
        c.stop();
        assertEquals(0, sessions.size());
        c.join(p, "ag_ada_01", 1);
        c.quit(p, "ag_ada_01");
        assertEquals(1, r.events.size());
    }

    @Test
    void quitWithoutAJoinStillEmitsWithZeroDurationAndNoSession() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = started(r);
        c.quit(new Object(), "ag_ada_01");
        Map<?, ?> q = r.eventAttrs.get(0);
        assertEquals(0L, q.get(AttrKeys.DURATION_MS));
        assertNull(q.get(AttrKeys.MC_SESSION));
        assertEquals("ag_ada_01", q.get(AttrKeys.LIFE_ID));
    }

    @Test
    void aThrowingEventLogNeverEscapes() {
        FakeRig r = new FakeRig();
        ConnectionCollector c = new ConnectionCollector(() -> {
            throw new IllegalStateException("clock");
        }, sessions);
        c.start(r.ctx());
        c.join(new Object(), "ag_ada_01", 1);
        c.quit(new Object(), "ag_ada_01");
        assertEquals(0, r.ends.get() - r.begins.get());
    }

    @Test
    void sessionsAreBoundedAndOverflowStillGetsAnId() {
        SessionIds s = new SessionIds(1, () -> "X" + seq.incrementAndGet());
        assertNotNull(s.open(new Object(), 0));
        assertNotNull(s.open(new Object(), 0));
        assertEquals(1, s.size());
        assertEquals(1, s.overflowed());
    }

    @Test
    void snapshotAttrsCarrySessionOnlyWhenKnown() {
        SnapshotCollector.Reading v = new SnapshotCollector.Reading("w", 0, 0, 0, 20, 20, 0, "survival");
        assertEquals("S9", SnapshotCollector.attrs("ag_ada_01", v, "S9").get(AttrKeys.MC_SESSION));
        assertNull(SnapshotCollector.attrs("ag_ada_01", v, null).get(AttrKeys.MC_SESSION));
        assertNull(SnapshotCollector.attrs("ag_ada_01", v, "").get(AttrKeys.MC_SESSION));
    }
}
