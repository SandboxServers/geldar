package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.geldar.core.EventEnvelope;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class EventMappingTest {
    private static final Instant AT = Instant.parse("2026-11-17T12:00:00Z");
    private static final String LIFE = "ag_wren_02";

    /** The schema's required envelope fields, checked by hand (event.schema.json): the export's own check. */
    private static void assertEnvelopeShape(JsonObject o) {
        for (String field : new String[] {"source_event_id", "at", "shard", "world_day", "world_tick", "type", "payload"}) {
            assertTrue(o.has(field), "missing " + field);
        }
        assertTrue(o.get("source_event_id").getAsString().matches("^ev_[0-9A-Z]{26}$"));
        assertTrue(o.get("payload").isJsonObject());
    }

    @Test
    void damageUsesPaperFieldsAndTheConfiguredSubject() {
        EventEnvelope e = EventMapping.damage("nf", AT, 24_000L, LIFE, "FALL", 3.5);
        assertEquals("geldar.nf.damage", e.subject());
        assertEquals("damage", e.type());
        JsonObject o = e.toJson();
        assertEnvelopeShape(o);
        assertEquals(Set.of("cause", "amount", "player"), o.getAsJsonObject("payload").keySet());
        assertEquals("FALL", o.getAsJsonObject("payload").get("cause").getAsString());
        assertEquals(3.5, o.getAsJsonObject("payload").get("amount").getAsDouble());
        assertEquals(1L, e.worldDay());
        assertEquals(LIFE, o.get("agent_id").getAsString());
    }

    @Test
    void aLifeIdBecomesTheAgentId() {
        EventEnvelope e = EventMapping.sleep("nf", AT, 0L, LIFE);
        assertEquals(LIFE, e.toJson().get("agent_id").getAsString());
        assertEquals(LIFE, e.toJson().getAsJsonObject("payload").get("player").getAsString());
    }

    @Test
    void theSourceEventIdIsMintedOncePerEnvelope() {
        EventEnvelope e = EventMapping.sleep("nf", AT, 0L, "Steve");
        assertEquals(e.toJson().get("source_event_id"), e.toJson().get("source_event_id"));
        EventEnvelope other = EventMapping.sleep("nf", AT, 0L, "Steve");
        assertNotEquals(e.sourceEventId(), other.sourceEventId());
    }

    @Test
    void deathWritesCoordinatesAndDimensionAndLeavesDropsAbsent() {
        EventEnvelope e = EventMapping.death(
                "nf", AT, 100L, "Steve", "ENTITY_ATTACK", new EventMapping.Pos(-4, 64, 19), "minecraft:the_nether");
        JsonObject p = e.toJson().getAsJsonObject("payload");
        assertEquals("geldar.nf.death", e.subject());
        assertEquals("ENTITY_ATTACK", p.get("cause").getAsString());
        assertEquals(-4, p.get("x").getAsInt());
        assertEquals(64, p.get("y").getAsInt());
        assertEquals(19, p.get("z").getAsInt());
        assertEquals("nether", p.get("dimension").getAsString());
        assertFalse(p.has("drops"));
        assertFalse(p.has("drop_items"));
        assertFalse(p.has("respawn_x"));
    }

    @Test
    void deathWithoutAPositionOrCauseStillHasTheRequiredCause() {
        JsonObject p = EventMapping.death("nf", AT, 0L, "Steve", null, null, null)
                .toJson().getAsJsonObject("payload");
        assertEquals("UNKNOWN", p.get("cause").getAsString());
        assertFalse(p.has("x"));
        assertEquals("other", p.get("dimension").getAsString());
    }

    @Test
    void sleepCarriesThePlayerOnlyForALifeId() {
        JsonObject p = EventMapping.sleep("nf", AT, 0L, LIFE).toJson().getAsJsonObject("payload");
        assertEquals(Set.of("player"), p.keySet());
    }

    /** Human names (online-mode Microsoft names on the NeoForge shard) and look-alikes that are not life ids. */
    private static final List<String> HUMANS = List.of("Notch", "Alex_123", "ag_x");

    @Test
    void aHumanNameIsNeverExportedAndLeavesNoTrace() {
        for (String human : HUMANS) {
            assertFalse(EventEnvelope.isLifeId(human), human + " must not be a life id in this test");
            List<EventEnvelope> events = List.of(
                    EventMapping.damage("nf", AT, 0L, human, "FALL", 2.0),
                    EventMapping.death("nf", AT, 0L, human, "FALL", new EventMapping.Pos(1, 2, 3), "minecraft:overworld"),
                    EventMapping.sleep("nf", AT, 0L, human));
            for (EventEnvelope e : events) {
                JsonObject o = e.toJson();
                assertFalse(o.getAsJsonObject("payload").has("player"), e.type() + " must omit player for " + human);
                assertFalse(o.has("agent_id"), e.type() + " must have no agent_id for " + human);
                assertFalse(o.toString().contains(human), e.type() + " serialized envelope must not contain " + human);
            }
        }
    }

    @Test
    void aHumanDeathKeepsItsPositionsAndTimes() {
        JsonObject o = EventMapping.death("nf", AT, 7L, "Notch", "FALL", new EventMapping.Pos(1, 2, 3), "minecraft:the_nether")
                .toJson();
        JsonObject p = o.getAsJsonObject("payload");
        assertEquals(Set.of("cause", "x", "y", "z", "dimension"), p.keySet());
        assertEquals(1, p.get("x").getAsInt());
        assertEquals("nether", p.get("dimension").getAsString());
        assertEquals(7L, o.get("world_tick").getAsLong());
        assertEquals("2026-11-17T12:00:00Z", o.get("at").getAsString());
    }

    @Test
    void serverTpsKeepsPaperFieldsAndTheShardToken() {
        EventEnvelope e = EventMapping.serverTps("phase0", AT, 0L, 19.5, 3, 7L, false);
        assertEquals("geldar.phase0.server_tps", e.subject());
        JsonObject o = e.toJson();
        assertEnvelopeShape(o);
        assertEquals(Set.of("tps", "players", "dropped", "connected"), o.getAsJsonObject("payload").keySet());
        assertEquals(19.5, o.getAsJsonObject("payload").get("tps").getAsDouble());
        assertEquals(7L, o.getAsJsonObject("payload").get("dropped").getAsLong());
        assertFalse(o.getAsJsonObject("payload").get("connected").getAsBoolean());
        assertFalse(o.has("agent_id"));
    }

    @Test
    void dimensionIdsMapToTheContractWords() {
        assertEquals("overworld", EventMapping.dimensionOf("minecraft:overworld"));
        assertEquals("nether", EventMapping.dimensionOf("minecraft:the_nether"));
        assertEquals("end", EventMapping.dimensionOf("minecraft:the_end"));
        assertEquals("other", EventMapping.dimensionOf("minecraft:custom_dim"));
        assertEquals("other", EventMapping.dimensionOf(null));
    }

    @Test
    void damageSourceIdsMapToBukkitCauseNames() {
        assertEquals("FALL", EventMapping.causeOf("fall"));
        assertEquals("ENTITY_ATTACK", EventMapping.causeOf("player"));
        assertEquals("DROWNING", EventMapping.causeOf("drown"));
        assertEquals("CUSTOM", EventMapping.causeOf("someModdedType"));
        assertEquals("CUSTOM", EventMapping.causeOf(null));
    }
}
