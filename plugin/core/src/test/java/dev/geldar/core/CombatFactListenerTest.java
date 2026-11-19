package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.ProvenanceSink;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

/** The combat fact listener, driven through its package-private seams (entity types need a server). */
class CombatFactListenerTest {
    private static final String LIFE = "ag_wren_02";
    private static final String PLAYER_UUID = "11111111-2222-3333-4444-555555555555";
    private static final String MOB_UUID = "0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b";

    private final InMemoryEventPublisher mem = new InMemoryEventPublisher();
    private final EventExporter exporter = new EventExporter(
            mem, "phase0", () -> 100, () -> Instant.parse("2026-11-09T00:00:00Z"), Logger.getLogger("test"));
    private final List<String> sent = new ArrayList<>();
    private final ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicLong now = new AtomicLong(10);
    private final CombatFactListener listener = new CombatFactListener(exporter, sink, enabled::get, now::get);

    @Test
    void aRealShapedKillEmitsOneValidFactWithTheFourKeys() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.mobDied(MOB_UUID, "zombie", LIFE, PLAYER_UUID, 20);

        assertEquals(1, mem.events().size());
        EventEnvelope e = mem.events().get(0);
        assertEquals("geldar.phase0.combat_fact", e.subject());
        assertEquals(LIFE, e.agentId());
        assertTrue(EventSchemaCheck.errors(e).isEmpty(), () -> EventSchemaCheck.errors(e).toString());
        // EventExporter.emit adds "player" to every payload; the listener's own four are the rest.
        assertEquals(Set.of("life_id", "kind", "mob", "encounter_key", "player"), e.payload().keySet());
        assertEquals("hostile_kill", e.payload().get("kind").getAsString());
        assertEquals("zombie", e.payload().get("mob").getAsString());
        assertEquals("enc:" + LIFE + ":" + MOB_UUID, e.payload().get("encounter_key").getAsString());
    }

    @Test
    void aHumanNamedPlayerEmitsNothing() {
        listener.playerHurt("Steve", PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.playerHit("world", "Steve", PLAYER_UUID, MOB_UUID, "zombie", 11);
        listener.mobDied(MOB_UUID, "zombie", "Steve", PLAYER_UUID, 20);
        listener.playerDied("Steve", 21);

        assertTrue(mem.events().isEmpty());
        assertTrue(sent.isEmpty());
    }

    @Test
    void disabledEmitsNothing() {
        enabled.set(false);
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "zombie", 11);
        listener.mobDied(MOB_UUID, "zombie", LIFE, PLAYER_UUID, 20);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
        assertTrue(sent.isEmpty());
    }

    @Test
    void theFirstHitOfAnEncounterSendsOneEngagedMessage() {
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "zombie", 5);
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "zombie", 6);

        assertEquals(1, sent.size());
        assertTrue(sent.get(0).startsWith("combat "), sent.get(0));
        assertTrue(sent.get(0).contains("engaged"), sent.get(0));
    }

    @Test
    void tickClosesAQuietEncounterAfterMoreThanTwoHundredTicks() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        now.set(210);
        listener.tick();
        assertTrue(mem.events().isEmpty());

        now.set(211);
        listener.tick();
        assertEquals(1, mem.events().size());
        assertEquals("fight_survived", mem.events().get(0).payload().get("kind").getAsString());
    }
}
