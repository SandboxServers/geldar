package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class RecordingLedgerTest {
    @Test
    void recordsCountersByAttributeValues() {
        RecordingLedger ledger = new RecordingLedger();
        Counter c = ledger.counter("geldar_x_total", "1", "d", "world");
        c.bind("overworld").add(2);
        c.bind("overworld").add(3);
        c.bind("nether").add(7);
        assertEquals(5, ledger.counterValue("geldar_x_total", "overworld"));
        assertEquals(7, ledger.counterValue("geldar_x_total", "nether"));
        assertEquals(0, ledger.counterValue("geldar_x_total", "end"));
    }

    @Test
    void recordsHistogramValues() {
        RecordingLedger ledger = new RecordingLedger();
        ledger.histogram("geldar_h", "ms", "d", new double[] {1, 2}).bind().record(1.5);
        ledger.histogram("geldar_h", "ms", "d", new double[] {1, 2}).bind().record(2.5);
        assertEquals(java.util.List.of(1.5, 2.5), ledger.histogramValues("geldar_h"));
    }

    @Test
    void recordsEventsAndEmitMapAndContent() {
        RecordingLedger ledger = new RecordingLedger();
        int id = ledger.events().register("geldar.block.place", Severity.INFO, 5, "x", "y", "z", "block");
        ledger.events().record(id, 1, 2, 3, "stone", null, null);
        ledger.events().emitMap("geldar.server.config_snapshot", Severity.WARN, Attrs.of().lng("n", 4).build());
        var placed = ledger.events("geldar.block.place");
        assertEquals(1, placed.size());
        assertEquals(2, placed.get(0).b());
        assertEquals("stone", placed.get(0).s1());
        assertEquals(Severity.INFO, placed.get(0).severity());
        var snap = ledger.events("geldar.server.config_snapshot");
        assertEquals(4L, snap.get(0).attrs().get("n"));
        assertEquals(Severity.WARN, snap.get(0).severity());
        int cid = ledger.content().register("geldar.chat", "player");
        ledger.content().record(cid, "hello", "p1", null, null);
        assertEquals("hello", ledger.content("geldar.chat").get(0).text());
        assertEquals("p1", ledger.content("geldar.chat").get(0).s1());
        assertEquals(2, ledger.allEvents().size());
    }

    @Test
    void gaugeReadersAreStoredAndReadable() {
        RecordingLedger ledger = new RecordingLedger();
        ledger.gaugeLong("geldar_g", "1", "d", () -> 42);
        ledger.gaugeDouble("geldar_d", "1", "d", () -> 0.5);
        assertTrue(ledger.hasGauge("geldar_g"));
        assertEquals(42, ledger.readGaugeLong("geldar_g"));
        assertEquals(0.5, ledger.readGaugeDouble("geldar_d"));
    }

    @Test
    void mainThreadFlagFlagsForbiddenCalls() {
        FakeHostInfo host = new FakeHostInfo();
        RecordingLedger ledger = new RecordingLedger(host);
        ledger.gaugeLong("geldar_g", "1", "d", () -> 1);
        host.mainThread(false);
        ledger.readGaugeLong("geldar_g");
        ledger.events().emitMap("geldar.a", Severity.INFO, java.util.Map.of());
        assertTrue(ledger.mainThreadViolations().isEmpty());
        host.mainThread(true);
        assertTrue(host.isMainThread());
        ledger.readGaugeLong("geldar_g");
        ledger.events().emitMap("geldar.a", Severity.INFO, java.util.Map.of());
        assertEquals(2, ledger.mainThreadViolations().size());
        host.mainThread(false);
        assertFalse(host.isMainThread());
    }

    @Test
    void guardCanBeSwitchedOff() {
        RecordingLedger ledger = new RecordingLedger();
        assertTrue(ledger.guard("c").allowed());
        ledger.fakeGuard("c").disable();
        assertFalse(ledger.guard("c").allowed());
    }

    @Test
    void everyTicksFiresOncePerPeriod() {
        FakeHostScheduler s = new FakeHostScheduler();
        AtomicInteger runs = new AtomicInteger();
        s.everyTicks(20, runs::incrementAndGet);
        s.advanceTicks(19);
        assertEquals(0, runs.get());
        s.advanceTicks(1);
        assertEquals(1, runs.get());
        s.advanceTicks(60);
        assertEquals(4, runs.get());
    }

    @Test
    void everyMillisFiresIndependentlyOfTicks() {
        FakeHostScheduler s = new FakeHostScheduler();
        AtomicInteger runs = new AtomicInteger();
        s.everyMillis(100, runs::incrementAndGet);
        s.advanceTicks(1000);
        assertEquals(0, runs.get());
        s.advanceMillis(250);
        assertEquals(2, runs.get());
    }

    @Test
    void cancelStopsTaskAndIsRecordedOnce() {
        FakeHostScheduler s = new FakeHostScheduler();
        AtomicInteger runs = new AtomicInteger();
        Cancellable c = s.everyTicks(5, runs::incrementAndGet);
        s.advanceTicks(5);
        c.cancel();
        c.cancel();
        s.advanceTicks(50);
        assertEquals(1, runs.get());
        assertEquals(1, s.cancelCount());
        assertEquals(0, s.activeTasks());
    }

    @Test
    void fakeClockAdvancesAndDrivesTokenBucket() {
        FakeClock clock = new FakeClock(10);
        clock.advanceMillis(2);
        assertEquals(2_000_010L, clock.getAsLong());
        clock.set(5);
        assertEquals(5, clock.getAsLong());
        new FakeHostInfo().serverTick(9);
        assertEquals(9, new FakeHostInfo().serverTick(9).serverTick());
    }
}