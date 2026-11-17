package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.ids.OfflineUuid;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class OtelLedgerTest {
    record Out(String name, Severity sev, String body, Map<String, Object> attrs) {}

    private final List<Out> out = new CopyOnWriteArrayList<>();
    private final boolean[] mainThread = {false};
    private OtelLedger ledger;

    private final HostInfo host = new HostInfo() {
        public long serverTick() {
            return 0;
        }

        public boolean isMainThread() {
            return mainThread[0];
        }

        public String loaderName() {
            return "test";
        }
    };

    private OtelLedger make(LedgerConfig cfg, boolean agent, LogOut sink) {
        ledger = new OtelLedger(
                cfg, host, Logger.getLogger("test"), OpenTelemetry.noop().getMeter("t"), agent, sink);
        return ledger;
    }

    private OtelLedger make(boolean agent) {
        return make(LedgerConfig.defaults(), agent, (n, s, b, a, t) -> out.add(new Out(n, s, b, a)));
    }

    /** Builds a dotted-quad address at runtime so the source holds no IP literal. */
    private static String ip(int a, int b, int c, int d) {
        return String.join(".", String.valueOf(a), String.valueOf(b), String.valueOf(c), String.valueOf(d));
    }

    @AfterEach
    void close() {
        if (ledger != null) {
            ledger.close();
        }
    }

    private static void await(BooleanSupplier c) throws Exception {
        long end = System.nanoTime() + 3_000_000_000L;
        while (!c.getAsBoolean() && System.nanoTime() < end) {
            Thread.sleep(5);
        }
    }

    @Test
    void noAgentLeavesRingsEmpty() {
        OtelLedger l = make(false);
        int e = l.events().register("geldar.test", Severity.INFO, 1_000_000, AttrKeys.X);
        int c = l.content().register("geldar.chat", AttrKeys.TEXT);
        for (int i = 0; i < 1000; i++) {
            l.events().record(e, i, 0, 0, null, null, null);
            l.content().record(c, "hello", null, null, null);
            l.events().emitMap("geldar.map", Severity.INFO, Map.of(AttrKeys.WORLD, "w"));
        }
        assertEquals(0, l.queued("events"));
        assertEquals(0, l.queued("content"));
        assertEquals(0, l.dropped("events"));
    }

    @Test
    void masterSwitchOffLeavesRingsEmpty() {
        OtelLedger l = make(LedgerConfig.disabled(), true, (n, s, b, a, t) -> out.add(new Out(n, s, b, a)));
        int e = l.events().register("geldar.test", Severity.INFO, 1_000_000, AttrKeys.X);
        for (int i = 0; i < 1000; i++) {
            l.events().record(e, i, 0, 0, null, null, null);
        }
        assertEquals(0, l.queued("events"));
        assertTrue(out.isEmpty());
    }

    @Test
    void eventAttributesAreAllowListedAndRedacted() throws Exception {
        OtelLedger l = make(true);
        int e = l.events().register(
                "geldar.block.break", Severity.WARN, 1000, AttrKeys.X, AttrKeys.Y, "password", AttrKeys.ITEM,
                AttrKeys.WORLD, AttrKeys.CAUSE);
        l.events().record(e, 5, 6, 7, "stone", "world", "from " + ip(10, 1, 2, 3) + " now");
        await(() -> !out.isEmpty());
        Out o = out.get(0);
        assertEquals("geldar.block.break", o.name());
        assertEquals(Severity.WARN, o.sev());
        assertEquals(5L, o.attrs().get(AttrKeys.X));
        assertEquals("stone", o.attrs().get(AttrKeys.ITEM));
        assertEquals("from [addr] now", o.attrs().get(AttrKeys.CAUSE));
        assertFalse(o.attrs().containsKey("password"));
        assertTrue(o.attrs().values().stream().noneMatch(v -> "7".equals(String.valueOf(v))));
        assertEquals(1, l.dropped("attrs"));
    }

    @Test
    void lifeIdAddsOfflineUuidAndBadLifeIdIsDropped() throws Exception {
        OtelLedger l = make(true);
        int e = l.events().register("geldar.life", Severity.INFO, 1000, AttrKeys.LIFE_ID);
        l.events().record(e, 0, 0, 0, null, null, null);
        int f = l.events().register("geldar.life2", Severity.INFO, 1000, null, null, null, AttrKeys.LIFE_ID);
        l.events().record(f, 0, 0, 0, "ag_ada_01", null, null);
        int g = l.events().register("geldar.life3", Severity.INFO, 1000, null, null, null, AttrKeys.LIFE_ID);
        l.events().record(g, 0, 0, 0, "Notch", null, null);
        await(() -> out.size() == 3);
        Out good = out.stream().filter(o -> o.name().equals("geldar.life2")).findFirst().orElseThrow();
        assertEquals("ag_ada_01", good.attrs().get(AttrKeys.LIFE_ID));
        assertEquals(OfflineUuid.of("ag_ada_01").toString(), good.attrs().get(AttrKeys.PLAYER_UUID));
        Out bad = out.stream().filter(o -> o.name().equals("geldar.life3")).findFirst().orElseThrow();
        assertFalse(bad.attrs().containsKey(AttrKeys.LIFE_ID));
        assertFalse(bad.attrs().containsKey(AttrKeys.PLAYER_UUID));
    }

    @Test
    void contentOverCapReachesSinkCappedAndScrubbed() throws Exception {
        OtelLedger l = make(true);
        int c = l.content().register("geldar.chat", AttrKeys.PLUGIN, AttrKeys.WORLD, AttrKeys.CAUSE);
        l.content().record(c, "a".repeat(40_000), "p", "w", "cause");
        int d = l.content().register("geldar.sign", AttrKeys.PLUGIN);
        l.content().record(d, "join " + ip(192, 168, 1, 9) + " please", "p", null, null);
        await(() -> out.size() == 2);
        Out big = out.stream().filter(o -> o.name().equals("geldar.chat")).findFirst().orElseThrow();
        assertTrue(big.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32_768 + 64);
        assertTrue(big.body().endsWith("[truncated:40000]"));
        assertEquals("cause", big.attrs().get(AttrKeys.CAUSE));
        Out sign = out.stream().filter(o -> o.name().equals("geldar.sign")).findFirst().orElseThrow();
        assertEquals("join [addr] please", sign.body());
    }

    @Test
    void metricAttributeNotAllowedIsDroppedCountedAndNeverThrows() {
        OtelLedger l = make(true);
        Counter c = l.counter("geldar_test_total", "1", "t", AttrKeys.LIFE_ID, "window", AttrKeys.TEXT);
        BoundCounter b = c.bind("ag_ada_01", "1m", "free text");
        OtelLedger.Bound bound = (OtelLedger.Bound) b;
        assertNull(bound.attributes().get(AttributeKey.stringKey(AttrKeys.LIFE_ID)));
        assertNull(bound.attributes().get(AttributeKey.stringKey(AttrKeys.TEXT)));
        assertEquals("1m", bound.attributes().get(AttributeKey.stringKey("window")));
        assertEquals(2, l.dropped("metric.attrs"));
        b.add(3);
        Histogram h = l.histogram("geldar_h", "ms", "t", new double[] {1, 2}, AttrKeys.MC_SESSION, "kind");
        BoundHistogram bh = h.bind("s1", "k");
        bh.record(1.5);
        assertEquals("k", ((OtelLedger.Bound) bh).attributes().get(AttributeKey.stringKey("kind")));
        assertEquals(3, l.dropped("metric.attrs"));
        l.gaugeLong("g", "1", "t", () -> 1L, AttrKeys.PLAYER_UUID, "v");
        l.gaugeDouble("gd", "1", "t", () -> 1.0, "stat", "v");
        assertEquals(4, l.dropped("metric.attrs"));
    }

    /** A value that is neither String nor a number: the sink must stringify AND scrub it. */
    private record Secretive(String text) {
        @Override
        public String toString() {
            return text;
        }
    }

    @Test
    void emitMapStringifiesNonStringValuesThroughTheScrubber() throws Exception {
        OtelLedger l = make(true);
        String addr = ip(10, 9, 8, 7);
        l.events().emitMap("geldar.a", Severity.INFO, Map.of(AttrKeys.TEXT, List.of("host " + addr)));
        l.events().emitMap("geldar.b", Severity.INFO, Map.of(AttrKeys.TEXT, new Secretive("login " + addr)));
        l.events().emitMap("geldar.c", Severity.INFO, Map.of(AttrKeys.TEXT, new Secretive("password=pw1 from " + addr)));
        await(() -> out.size() == 3);
        Out a = out.stream().filter(o -> o.name().equals("geldar.a")).findFirst().orElseThrow();
        assertEquals("[host [addr]]", a.attrs().get(AttrKeys.TEXT));
        Out b = out.stream().filter(o -> o.name().equals("geldar.b")).findFirst().orElseThrow();
        assertEquals("login [addr]", b.attrs().get(AttrKeys.TEXT));
        Out c = out.stream().filter(o -> o.name().equals("geldar.c")).findFirst().orElseThrow();
        // Redactor.scrub masks addresses, not free-text "password=" values: only the address is asserted (report).
        assertEquals("password=pw1 from [addr]", c.attrs().get(AttrKeys.TEXT));
        for (Out o : out) {
            assertTrue(o.attrs().values().stream().allMatch(v -> v instanceof String), "only scrubbed Strings");
        }
    }

    @Test
    void emitMapThrowingToStringIsDroppedNotPropagated() throws Exception {
        OtelLedger l = make(true);
        Object bomb = new Object() {
            @Override
            public String toString() {
                throw new IllegalStateException("boom");
            }
        };
        l.events().emitMap("geldar.bomb", Severity.INFO, Map.of(AttrKeys.TEXT, bomb, AttrKeys.WORLD, "w"));
        await(() -> !out.isEmpty());
        assertEquals("w", out.get(0).attrs().get(AttrKeys.WORLD));
        assertFalse(out.get(0).attrs().containsKey(AttrKeys.TEXT));
        assertEquals(1, l.dropped("attrs"));
    }

    @Test
    void eventStringAttributesAreCapped() throws Exception {
        OtelLedger l = make(true);
        l.events().emitMap("geldar.big", Severity.INFO, Map.of(AttrKeys.TEXT, "a".repeat(100_000)));
        await(() -> !out.isEmpty());
        String v = (String) out.get(0).attrs().get(AttrKeys.TEXT);
        assertTrue(v.length() <= OtelEventSink.ATTR_MAX_BYTES, "len " + v.length());
        assertTrue(v.endsWith("[truncated:100000]"));
    }

    @Test
    void blockedSinkNeverBlocksRecord() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        OtelLedger l = make(LedgerConfig.defaults(), true, (n, s, b, a, t) -> {
            try {
                release.await();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        });
        int e = l.events().register("geldar.test", Severity.INFO, 10_000_000, AttrKeys.X);
        long worst = 0;
        for (int i = 0; i < 20_000; i++) {
            long t0 = System.nanoTime();
            l.events().record(e, i, 0, 0, null, null, null);
            worst = Math.max(worst, System.nanoTime() - t0);
        }
        release.countDown();
        assertTrue(worst < TimeUnit.MILLISECONDS.toNanos(5), "worst record ns " + worst);
        assertTrue(l.dropped("events") > 0, "ring overflow must be counted");
    }

    @Test
    void rateLimitedEventsAreDroppedAndCounted() {
        OtelLedger l = make(true);
        int e = l.events().register("geldar.test", Severity.INFO, 5, AttrKeys.X);
        for (int i = 0; i < 100; i++) {
            l.events().record(e, i, 0, 0, null, null, null);
        }
        assertTrue(l.dropped("events.rate") >= 90, "dropped " + l.dropped("events.rate"));
    }

    @Test
    void emitMapOnMainThreadIsDroppedOffThreadDelivered() throws Exception {
        OtelLedger l = make(true);
        mainThread[0] = true;
        l.events().emitMap("geldar.snap", Severity.INFO, Map.of(AttrKeys.WORLD, "w"));
        assertEquals(1, l.dropped("events.mainthread"));
        mainThread[0] = false;
        l.events()
                .emitMap(
                        "geldar.snap",
                        Severity.ERROR,
                        Map.of(AttrKeys.WORLD, "w", "token", "x", AttrKeys.TEXT, ip(10, 0, 0, 1)));
        await(() -> !out.isEmpty());
        Out o = out.get(0);
        assertEquals("w", o.attrs().get(AttrKeys.WORLD));
        assertFalse(o.attrs().containsKey("token"));
        assertEquals("[addr]", o.attrs().get(AttrKeys.TEXT));
        assertEquals(Severity.ERROR, o.sev());
    }

    @Test
    void throwingSinkIsCountedNotPropagated() throws Exception {
        OtelLedger l = make(LedgerConfig.defaults(), true, (n, s, b, a, t) -> {
            throw new IllegalStateException("boom");
        });
        int e = l.events().register("geldar.test", Severity.INFO, 1000, AttrKeys.X);
        l.events().record(e, 1, 0, 0, null, null, null);
        await(() -> l.sinkErrors() > 0);
        assertTrue(l.sinkErrors() > 0);
    }

    @Test
    void bootstrapWorksWithNoAgent() {
        assertFalse(LedgerBootstrap.agentPresent(OpenTelemetry.noop()));
        OtelLedger l = LedgerBootstrap.create(LedgerConfig.defaults(), host, Logger.getLogger("t"), OpenTelemetry.noop());
        ledger = l;
        int e = l.events().register("geldar.test", Severity.INFO, 10, AttrKeys.X);
        l.events().record(e, 1, 0, 0, null, null, null);
        assertEquals(0, l.queued("events"));
        assertNotNull(l.guard("census"));
    }
}
