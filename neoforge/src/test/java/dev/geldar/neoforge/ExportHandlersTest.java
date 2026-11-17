package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.BoundedEventQueue;
import dev.geldar.core.EventEnvelope;
import dev.geldar.core.EventPublisher;
import dev.geldar.core.InMemoryEventPublisher;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ExportHandlersTest {
    private static final Instant AT = Instant.parse("2026-11-17T12:00:00Z");

    /** Collects operator warnings; the handlers must log a failure, not throw it. */
    private static final class Warnings implements OperatorSink {
        final List<String> warnings = new ArrayList<>();

        @Override
        public void info(String message) {}

        @Override
        public void warn(String message) {
            warnings.add(message);
        }
    }

    /** A publisher that bounds its queue and drops the oldest event when full, as core-common does. */
    private static final class DroppingPublisher implements EventPublisher {
        final BoundedEventQueue<EventEnvelope> queue;

        DroppingPublisher(int capacity) {
            queue = new BoundedEventQueue<>(capacity);
        }

        @Override
        public void publish(EventEnvelope event) {
            queue.offer(event);
        }

        @Override
        public long dropped() {
            return queue.dropped();
        }

        @Override
        public void close() {}
    }

    private static ExportConfig enabled(String shard) {
        return new ExportConfig(true, "nats://example.invalid:4222", shard, null, null, 10);
    }

    private static ExportLifecycle started(EventPublisher publisher, Warnings sink) {
        ExportLifecycle lifecycle = new ExportLifecycle(enabled("nf"), (config, log) -> publisher, sink);
        lifecycle.start();
        return lifecycle;
    }

    @Test
    void theThreeEventHandlersPublishOnTheShardSubject() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(started(mem, sink), "nf", () -> AT, sink);
        h.damage("ag_wren_02", "FALL", 4.0);
        h.death("Steve", "FALL", new EventMapping.Pos(1, 2, 3), "minecraft:overworld");
        h.sleep("Steve");
        assertEquals(3, mem.events().size());
        assertEquals("geldar.nf.damage", mem.events().get(0).subject());
        assertEquals("ag_wren_02", mem.events().get(0).agentId());
        assertEquals("geldar.nf.death", mem.events().get(1).subject());
        assertEquals("geldar.nf.sleep", mem.events().get(2).subject());
        assertTrue(sink.warnings.isEmpty());
    }

    @Test
    void aHumanNameIsNeverPublishedByAnyEventHandler() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(started(mem, sink), "nf", () -> AT, sink);
        h.damage("Notch", "FALL", 4.0);
        h.death("Notch", "FALL", new EventMapping.Pos(1, 2, 3), "minecraft:overworld");
        h.sleep("Notch");
        assertEquals(3, mem.events().size());
        for (EventEnvelope e : mem.events()) {
            assertFalse(e.toJson().getAsJsonObject("payload").has("player"), e.type());
            assertNull(e.agentId(), e.type());
            assertFalse(e.toJson().toString().contains("Notch"), e.type());
        }
        assertTrue(sink.warnings.isEmpty());
    }

    @Test
    void aHumanNameIsNeverInAnOperatorWarning() {
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(
                started(new InMemoryEventPublisher(), sink),
                "nf",
                () -> {
                    throw new IllegalStateException("clock");
                },
                sink);
        h.damage("Notch", "FALL", 4.0);
        h.death("Notch", "FALL", new EventMapping.Pos(1, 2, 3), "minecraft:overworld");
        h.sleep("Notch");
        assertEquals(3, sink.warnings.size());
        for (String warning : sink.warnings) {
            assertFalse(warning.contains("Notch"), warning);
        }
    }

    @Test
    void serverTpsIsWrittenOnlyEvery400Ticks() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(started(mem, sink), "nf", () -> AT, sink);
        for (int i = 0; i < ExportHandlers.TPS_EVERY_TICKS - 1; i++) {
            h.tickStart(0L);
            h.tickEnd(50_000_000L, i, 2);
        }
        assertEquals(0, mem.events().size());
        h.tickStart(0L);
        h.tickEnd(50_000_000L, 400L, 2);
        assertEquals(1, mem.events().size());
        EventEnvelope tps = mem.events().get(0);
        assertEquals("geldar.nf.server_tps", tps.subject());
        assertEquals(20.0, tps.payload().get("tps").getAsDouble(), 1e-9);
        assertEquals(2, tps.payload().get("players").getAsInt());
        assertEquals(0L, tps.payload().get("dropped").getAsLong());
        assertTrue(tps.payload().get("connected").getAsBoolean(), "an in-memory publisher has no connection to lose");
    }

    @Test
    void aFullQueueNeverBlocksTheHandlers() {
        DroppingPublisher queue = new DroppingPublisher(2);
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(started(queue, sink), "nf", () -> AT, sink);
        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
            for (int i = 0; i < 1000; i++) {
                h.damage("Steve", "FALL", 1.0);
            }
        });
        assertEquals(998L, queue.dropped());
    }

    @Test
    void aStoppedExportIsSilentAndDoesNotThrow() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        Warnings sink = new Warnings();
        ExportLifecycle lifecycle = started(mem, sink);
        lifecycle.stop();
        ExportHandlers h = new ExportHandlers(lifecycle, "nf", () -> AT, sink);
        assertDoesNotThrow(() -> h.sleep("Steve"));
        assertEquals(0, mem.events().size());
    }

    @Test
    void aFailingClockIsLoggedOnceAndTheEventIsSkipped() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        Warnings sink = new Warnings();
        ExportHandlers h = new ExportHandlers(started(mem, sink), "nf", () -> {
            throw new IllegalStateException("clock");
        }, sink);
        assertDoesNotThrow(() -> h.damage("Steve", "FALL", 1.0));
        assertEquals(0, mem.events().size());
        assertEquals(1, sink.warnings.size());
        assertTrue(sink.warnings.get(0).contains("damage"));
    }
}
