package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class EventEnvelopeTest {
    private static final Instant AT = Instant.parse("2026-11-09T10:15:30.123Z");

    private static EventEnvelope make(String type, String agent) {
        return EventEnvelope.create(AT, "phase0", 48_500, type, agent, new JsonObject());
    }

    @Test
    void envelopesAreSchemaValidForEveryPhase0Type() {
        for (String type : new String[] {"server_tps", "damage", "death", "sleep"}) {
            assertTrue(EventSchemaCheck.errors(make(type, null)).isEmpty(), type);
            assertTrue(EventSchemaCheck.errors(make(type, "ag_kestrel_01")).isEmpty(), type);
        }
    }

    @Test
    void schemaCheckRejectsABadEnvelope() {
        EventEnvelope bad = new EventEnvelope("nope", AT, "phase0", 0, 0, "damage", null, new JsonObject());
        assertFalse(EventSchemaCheck.errors(bad).isEmpty());
    }

    @Test
    void idsAreUniqueAndSubjectFollowsShardAndType() {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            assertTrue(ids.add(make("damage", null).sourceEventId()));
        }
        assertEquals("geldar.phase0.damage", make("damage", null).subject());
    }

    @Test
    void worldDayDerivesFromTickAndAgentIdIsOptional() {
        EventEnvelope e = make("sleep", null);
        assertEquals(2, e.worldDay());
        assertNull(e.toJson().get("agent_id"));
        assertEquals("ag_kestrel_01", make("sleep", "ag_kestrel_01").toJson().get("agent_id").getAsString());
    }
}