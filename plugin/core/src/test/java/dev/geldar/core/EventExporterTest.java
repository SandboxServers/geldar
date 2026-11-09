package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class EventExporterTest {
    private static final Logger LOG = Logger.getLogger("test");

    private static EventExporter exporter(EventPublisher publisher) {
        return new EventExporter(publisher, "phase0", () -> 24_100, () -> Instant.parse("2026-11-09T00:00:00Z"), LOG);
    }

    @Test
    void tpsEventIsSchemaValidOnTheTpsSubject() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        exporter(mem).exportTps(19.97, 3);
        EventEnvelope e = mem.events().get(0);
        assertEquals("geldar.phase0.server_tps", e.subject());
        assertEquals(1, e.worldDay());
        assertTrue(EventSchemaCheck.errors(e).isEmpty());
    }

    @Test
    void tpsPayloadReportsDropsAndConnection() {
        List<EventEnvelope> seen = new ArrayList<>();
        EventPublisher degraded = new EventPublisher() {
            @Override
            public void publish(EventEnvelope event) {
                seen.add(event);
            }

            @Override
            public long dropped() {
                return 7;
            }

            @Override
            public boolean connected() {
                return false;
            }

            @Override
            public void close() {}
        };
        exporter(degraded).exportTps(19.5, 2);
        JsonObject payload = seen.get(0).payload();
        assertEquals(7, payload.get("dropped").getAsLong());
        assertFalse(payload.get("connected").getAsBoolean());
        assertTrue(EventSchemaCheck.errors(seen.get(0)).isEmpty());
    }

    @Test
    void theReservedDlqTypeIsRejectedAndNeverPublished() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        exporter(mem).emit("dlq", null, new JsonObject());
        assertTrue(mem.events().isEmpty());
        assertThrows(IllegalArgumentException.class,
                () -> EventEnvelope.create(Instant.now(), "phase0", 1, "dlq", null, new JsonObject()));
    }

    @Test
    void playerNameBecomesAgentIdOnlyWhenItIsALifeId() {
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        EventExporter ex = exporter(mem);
        ex.emit("sleep", "ag_wren_02", new JsonObject());
        ex.emit("sleep", "Steve", new JsonObject());
        assertEquals("ag_wren_02", mem.events().get(0).agentId());
        assertEquals(null, mem.events().get(1).agentId());
        assertTrue(EventSchemaCheck.errors(mem.events().get(1)).isEmpty());
    }

    @Test
    void publisherFailureNeverReachesTheServerThread() {
        EventPublisher boom = new EventPublisher() {
            @Override
            public void publish(EventEnvelope event) {
                throw new IllegalStateException("nats down");
            }

            @Override
            public void close() {}
        };
        assertDoesNotThrow(() -> exporter(boom).exportTps(20.0, 0));
        assertDoesNotThrow(() -> exporter(boom).emit("death", "ag_wren_02", new JsonObject()));
    }
}