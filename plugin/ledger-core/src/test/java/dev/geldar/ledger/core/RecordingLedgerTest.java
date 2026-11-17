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
    void fakeClockDrivesATokenBucket() {
        FakeClock clock = new FakeClock(10);
        clock.advanceMillis(2);
        assertEquals(2_000_010L, clock.getAsLong());
        clock.set(5);
        assertEquals(5, clock.getAsLong());
        clock.set(0);
        TokenBucket bucket = new TokenBucket(2, clock);
        assertTrue(bucket.tryTake());
        assertTrue(bucket.tryTake());
        assertFalse(bucket.tryTake(), "burst of two is spent");
        clock.advanceMillis(499);
        assertFalse(bucket.tryTake(), "half a second per token at 2/s");
        clock.advanceMillis(1);
        assertTrue(bucket.tryTake());
        assertFalse(bucket.tryTake());
        clock.advanceNanos(1_000_000_000L);
        assertTrue(bucket.tryTake());
        assertTrue(bucket.tryTake());
        assertFalse(bucket.tryTake());
    }

    @Test
    void gaugeRegistrationsWithDifferentPairsDoNotOverwriteEachOther() {
        RecordingLedger ledger = new RecordingLedger();
        ledger.gaugeLong("geldar_disk_bytes", "By", "d", () -> 1, "area", "world");
        ledger.gaugeLong("geldar_disk_bytes", "By", "d", () -> 2, "area", "logs");
        ledger.gaugeDouble("geldar_dd", "1", "d", () -> 0.25, "area", "world");
        ledger.gaugeDouble("geldar_dd", "1", "d", () -> 0.75, "area", "logs");
        assertEquals(1, ledger.readGaugeLong("geldar_disk_bytes", "world"));
        assertEquals(2, ledger.readGaugeLong("geldar_disk_bytes", "logs"));
        assertEquals(0.25, ledger.readGaugeDouble("geldar_dd", "world"));
        assertEquals(0.75, ledger.readGaugeDouble("geldar_dd", "logs"));
        assertEquals(2, ledger.registrations("geldar_disk_bytes").size());
        assertEquals(java.util.List.of("area", "logs"), ledger.registrations("geldar_disk_bytes").get(1).attrArgs());
        assertEquals("gaugeLong", ledger.registrations("geldar_disk_bytes").get(0).kind());
        assertTrue(ledger.hasGauge("geldar_dd"));
        assertFalse(ledger.hasGauge("geldar_none"));
        assertTrue(ledger.rejectedMetricKeys().isEmpty());
    }

    @Test
    void anAmbiguousOrUnknownGaugeReadFailsLoudly() {
        RecordingLedger ledger = new RecordingLedger();
        ledger.gaugeLong("g", "1", "d", () -> 1, "area", "a");
        ledger.gaugeLong("g", "1", "d", () -> 2, "area", "b");
        assertEquals(1, ledger.readGaugeLong("g", "a"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> ledger.readGaugeLong("g"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () -> ledger.readGaugeLong("g", "z"));
        ledger.gaugeLong("solo", "1", "d", () -> 9);
        assertEquals(9, ledger.readGaugeLong("solo"));
    }

    @Test
    void metricKeysAreCheckedLikeTheRealBinding() {
        RecordingLedger ledger = new RecordingLedger();
        ledger.counter("c", "1", "d", "world", AttrKeys.TEXT);
        ledger.histogram("h", "ms", "d", new double[] {1}, AttrKeys.LIFE_ID);
        ledger.gaugeLong("g", "1", "d", () -> 1, "area", "plugin_data", "geldar.world", "x");
        ledger.gaugeLong("odd", "1", "d", () -> 1, "area", "w", "kind");
        assertEquals(java.util.List.of(AttrKeys.TEXT, AttrKeys.LIFE_ID, "geldar.world", "kind"),
                ledger.rejectedMetricKeys());
        // "plugin_data" is a gauge VALUE, never a rejected key.
        assertFalse(ledger.rejectedMetricKeys().contains("plugin_data"));
    }

    @Test
    void counterAndHistogramReadsTakeAttrValuesPerSeries() {
        RecordingLedger ledger = new RecordingLedger();
        Counter c = ledger.counter("c", "1", "d", "world", "kind");
        c.bind("w1", "a").add(1);
        c.bind("w1", "b").add(2);
        assertEquals(1, ledger.counterValue("c", "w1", "a"));
        assertEquals(2, ledger.counterValue("c", "w1", "b"));
        assertEquals(0, ledger.counterValue("c", "w1"));
        ledger.histogram("h", "ms", "d", new double[] {1}, "op").bind("r").record(3);
        assertEquals(java.util.List.of(3.0), ledger.histogramValues("h", "r"));
        assertTrue(ledger.histogramValues("h", "w").isEmpty());
        assertEquals(1, ledger.registrations("c").size());
    }
}