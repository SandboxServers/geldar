package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

/** Metric registration kinds and gauge attribute pairs, observed through a recording {@link RecordingMeter}. */
class OtelLedgerMetricsTest {
    private static final AttributeKey<String> AREA = AttributeKey.stringKey("area");
    private final RecordingMeter rm = new RecordingMeter();
    private final HostInfo host = new FakeHostInfo();

    private OtelLedger ledger() {
        return new OtelLedger(LedgerConfig.defaults(), host, Logger.getLogger("t"), rm.meter, false, (n, s, b, a, t) -> {});
    }

    private static Attributes area(String v) {
        return Attributes.of(AREA, v);
    }

    @Test
    void droppedTotalIsAnObservableCounterAndDepthStaysAGauge() {
        OtelLedger l = ledger();
        RecordingMeter.Instrument dropped = rm.named(Names.Queue.DROPPED_TOTAL).get(0);
        assertEquals("counterBuilder", dropped.kind);
        assertTrue(dropped.observable);
        assertTrue(dropped.longs);
        assertEquals("gaugeBuilder", rm.named(Names.Queue.DEPTH).get(0).kind);
        assertTrue(dropped.fire().stream().allMatch(p -> p.value() instanceof Long));
    }

    @Test
    void droppedTotalReportsTheMonotonicDropCounts() {
        OtelLedger l = ledger();
        l.counter("c", "1", "d", AttrKeys.TEXT); // one metric.attrs drop
        var points = rm.named(Names.Queue.DROPPED_TOTAL).get(0).fire();
        assertTrue(points.stream().anyMatch(p -> p.value().longValue() == 1L
                && "metric.attrs".equals(p.attrs().get(AttributeKey.stringKey("queue")))), points.toString());
    }

    @Test
    void containerTotalsStayGaugesAsReadmeSection4Says() {
        OtelLedger l = ledger();
        l.gaugeLong(Names.Container.CPU_PERIODS_TOTAL, "1", "d", () -> 5L);
        assertEquals("gaugeBuilder", rm.named(Names.Container.CPU_PERIODS_TOTAL).get(0).kind);
    }

    @Test
    void eachAreaIsADistinctSeriesOfOneInstrument() {
        OtelLedger l = ledger();
        String[] areas = {"world", "plugin_data", "logs", "bluemap", "chunky"};
        long v = 10;
        for (String a : areas) {
            long val = v++;
            l.gaugeLong("geldar_disk_bytes", "By", "d", () -> val, "area", a);
        }
        assertEquals(0, l.dropped("metric.attrs"), "values are never checked as keys");
        assertEquals(1, rm.named("geldar_disk_bytes").size());
        var points = rm.named("geldar_disk_bytes").get(0).fire();
        assertEquals(5, points.size());
        v = 10;
        for (String a : areas) {
            long expected = v++;
            assertTrue(points.stream().anyMatch(p -> p.attrs().equals(area(a)) && p.value().longValue() == expected),
                    a + " in " + points);
        }
    }

    @Test
    void reRegisteringTheSameSeriesReplacesInsteadOfDuplicating() {
        OtelLedger l = ledger();
        l.gaugeLong("g", "1", "d", () -> 1L, "area", "logs");
        l.gaugeLong("g", "1", "d", () -> 2L, "area", "logs");
        var points = rm.named("g").get(0).fire();
        assertEquals(1, points.size());
        assertEquals(2L, points.get(0).value().longValue());
    }

    @Test
    void gaugeDoubleAlsoRecordsItsPairs() {
        OtelLedger l = ledger();
        l.gaugeDouble("gd", "1", "d", () -> 0.5, "area", "world");
        var points = rm.named("gd").get(0).fire();
        assertEquals(List.of(area("world")), points.stream().map(RecordingMeter.Point::attrs).toList());
        assertEquals(0.5, points.get(0).value().doubleValue());
    }

    @Test
    void aDisallowedKeyDropsTheAttributeSetCountsAndNeverThrows() {
        OtelLedger l = ledger();
        l.gaugeLong("g1", "1", "d", () -> 1L, "geldar.world", "w");
        assertEquals(1, l.dropped("metric.attrs"));
        var points = rm.named("g1").get(0).fire();
        assertEquals(Attributes.empty(), points.get(0).attrs());
        l.gaugeLong("g2", "1", "d", () -> 1L, "area", "world", AttrKeys.TEXT, "free");
        assertEquals(2, l.dropped("metric.attrs"));
        assertEquals(Attributes.empty(), rm.named("g2").get(0).fire().get(0).attrs());
    }

    @Test
    void anOddNumberOfArgsDropsTheUnpairedLastKeyAndCountsIt() {
        OtelLedger l = ledger();
        l.gaugeLong("g", "1", "d", () -> 1L, "area", "logs", "kind");
        assertEquals(1, l.dropped("metric.attrs"));
        assertEquals(area("logs"), rm.named("g").get(0).fire().get(0).attrs());
        l.gaugeLong("only", "1", "d", () -> 1L, "area");
        assertEquals(2, l.dropped("metric.attrs"));
        assertEquals(Attributes.empty(), rm.named("only").get(0).fire().get(0).attrs());
    }

    @Test
    void nullAndOverlongValuesAreDroppedAndCounted() {
        OtelLedger l = ledger();
        l.gaugeLong("n", "1", "d", () -> 1L, "area", null);
        l.gaugeLong("long", "1", "d", () -> 1L, "area", "x".repeat(OtelLedger.MAX_GAUGE_VALUE + 1));
        l.gaugeLong("ok", "1", "d", () -> 1L, "area", "x".repeat(OtelLedger.MAX_GAUGE_VALUE));
        assertEquals(2, l.dropped("metric.attrs"));
        assertEquals(Attributes.empty(), rm.named("n").get(0).fire().get(0).attrs());
        assertEquals(Attributes.empty(), rm.named("long").get(0).fire().get(0).attrs());
        assertFalse(rm.named("ok").get(0).fire().get(0).attrs().isEmpty());
    }

    @Test
    void aFailingReaderDoesNotStopTheOtherSeries() {
        OtelLedger l = ledger();
        l.gaugeLong("g", "1", "d", () -> {
            throw new IllegalStateException("x");
        }, "area", "logs");
        l.gaugeLong("g", "1", "d", () -> 3L, "area", "world");
        var points = rm.named("g").get(0).fire();
        assertEquals(List.of(area("world")), points.stream().map(RecordingMeter.Point::attrs).toList());
    }
}
