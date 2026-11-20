package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.networknt.schema.Error;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;
import dev.geldar.core.blockowner.ProvenanceSink;
import dev.geldar.core.provenance.ProvenanceJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.projectiles.BlockProjectileSource;
import org.junit.jupiter.api.Test;

/**
 * The combat fact listener, driven through its package-private seams. Entity types need a server, so the shooter and
 * filter tests use java.lang.reflect.Proxy doubles for the interfaces only.
 */
class CombatFactListenerTest {
    private static final String LIFE = "ag_wren_02";
    private static final String PLAYER_UUID = "11111111-2222-3333-4444-555555555555";
    private static final String MOB_UUID = "0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b";
    private static final String SKELETON_UUID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
    private static final String ARROW_UUID = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";

    private final InMemoryEventPublisher mem = new InMemoryEventPublisher();
    private final EventExporter exporter = new EventExporter(
            mem, "phase0", () -> 100, () -> Instant.parse("2026-11-09T00:00:00Z"), Logger.getLogger("test"));
    private final List<String> sent = new ArrayList<>();
    private final ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicLong now = new AtomicLong(10);
    private final CombatFactListener listener = new CombatFactListener(exporter, sink, enabled::get, now::get);

    @Test
    void aRealShapedKillEmitsOneSchemaValidFactWithFiveKeys() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.mobDied(MOB_UUID, "zombie", LIFE, PLAYER_UUID, 20);

        assertEquals(1, mem.events().size());
        EventEnvelope e = mem.events().get(0);
        assertEquals("geldar.phase0.combat_fact", e.subject());
        assertEquals(LIFE, e.agentId());
        assertTrue(EventSchemaCheck.errors(e).isEmpty(), () -> EventSchemaCheck.errors(e).toString());
        // The emitted payload, including "player" that EventExporter.emit adds, against the combat-fact schema.
        assertTrue(payloadErrors(e.payload()).isEmpty(), () -> payloadErrors(e.payload()).toString());
        assertEquals(Set.of("life_id", "kind", "mob", "encounter_key", "player"), e.payload().keySet());
        assertEquals("hostile_kill", e.payload().get("kind").getAsString());
        assertEquals("zombie", e.payload().get("mob").getAsString());
        String key = e.payload().get("encounter_key").getAsString();
        assertEquals("enc:" + LIFE + ":" + MOB_UUID, key);
        // The life part of the key is the text between "enc:" and the last ":".
        String lifePart = key.substring("enc:".length(), key.lastIndexOf(':'));
        assertEquals(e.payload().get("life_id").getAsString(), lifePart);
        assertEquals(e.payload().get("player").getAsString(), lifePart);
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
    void theFirstHitOfAnEncounterSendsOneExactEngagedMessage() {
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "zombie", 5);
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "zombie", 6);

        assertEquals(List.of("combat " + ProvenanceJson.combatJson("world", LIFE, "zombie", "engaged", 5)), sent);
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

    @Test
    void nonHostileMobsOpenNothingAndEmitNothing() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "cow", 10);
        listener.playerHit("world", LIFE, PLAYER_UUID, MOB_UUID, "wolf", 11);
        listener.mobDied(MOB_UUID, "cow", LIFE, PLAYER_UUID, 20);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
        assertTrue(sent.isEmpty());
    }

    @Test
    void aPlayersDeathClosesTheirOpenEncounterWithNoFact() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.playerDied(LIFE, 20);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
    }

    @Test
    void withoutADeathTheQuietEncounterSurvives() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        now.set(500);
        listener.tick();

        assertEquals(1, mem.events().size());
        assertEquals("fight_survived", mem.events().get(0).payload().get("kind").getAsString());
    }

    @Test
    void aDeathOfAnotherNameLeavesALivesEncounterOpen() {
        // Equivalent to a mutant that drops the isLifeId guard: no encounter belongs to "Steve", so the tracker
        // cannot tell the difference. Kept as a behaviour pin, not as a kill.
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        listener.playerDied("Steve", 20);
        now.set(500);
        listener.tick();

        assertEquals(1, mem.events().size());
    }

    @Test
    void theTickIsSilentWhileDisabledAndAnOpenEncounterClosesOnReenable() {
        // Recorded in the worknote: an encounter kept open while disabled closes with a stale fight_survived.
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        enabled.set(false);
        now.set(500);
        listener.tick();
        assertTrue(mem.events().isEmpty());

        enabled.set(true);
        listener.tick();
        assertEquals(1, mem.events().size());
        assertEquals("fight_survived", mem.events().get(0).payload().get("kind").getAsString());
    }

    @Test
    void aHurtWhileDisabledOpensNothing() {
        enabled.set(false);
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        enabled.set(true);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
    }

    @Test
    void aDeathWhileDisabledKeepsTheEncounterOpen() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        enabled.set(false);
        listener.playerDied(LIFE, 20);
        enabled.set(true);
        now.set(500);
        listener.tick();

        assertEquals(1, mem.events().size());
        assertEquals("fight_survived", mem.events().get(0).payload().get("kind").getAsString());
    }

    @Test
    void aSkeletonsArrowIsTheSkeletonsHitNotTheArrowsAndNotAPlayersHit() {
        Entity skeleton =
                fake(LivingEntity.class, Map.<String, Object>of("getUniqueId", UUID.fromString(SKELETON_UUID)));
        Entity arrow = fake(Projectile.class, Map.<String, Object>of("getShooter", skeleton));
        Entity player = fake(Player.class, Map.<String, Object>of("getUniqueId", UUID.fromString(PLAYER_UUID)));

        Entity source = CombatFactListener.shooterOf(arrow);

        assertSame(skeleton, source);
        assertEquals(SKELETON_UUID, source.getUniqueId().toString());
        assertTrue(CombatFactListener.isPlayerHurt(player, source));
        assertFalse(CombatFactListener.isPlayerHit(player, source));
    }

    @Test
    void aPlayersArrowIsAPlayerHitOnAMob() {
        Entity player = fake(Player.class, Map.<String, Object>of("getUniqueId", UUID.fromString(PLAYER_UUID)));
        Entity zombie = fake(LivingEntity.class, Map.<String, Object>of("getUniqueId", UUID.fromString(MOB_UUID)));
        Entity arrow = fake(Projectile.class, Map.<String, Object>of("getShooter", player));

        Entity source = CombatFactListener.shooterOf(arrow);

        assertSame(player, source);
        assertTrue(CombatFactListener.isPlayerHit(zombie, source));
        assertFalse(CombatFactListener.isPlayerHurt(zombie, source));
    }

    @Test
    void aPlayersArrowAtAnotherPlayerIsNeitherAHurtNorAHit() {
        Entity shooter = fake(Player.class, Map.<String, Object>of("getUniqueId", UUID.fromString(PLAYER_UUID)));
        Entity victim = fake(Player.class, Map.<String, Object>of("getUniqueId", UUID.fromString(MOB_UUID)));
        Entity arrow = fake(Projectile.class, Map.<String, Object>of("getShooter", shooter));

        Entity source = CombatFactListener.shooterOf(arrow);

        assertFalse(CombatFactListener.isPlayerHurt(victim, source));
        assertFalse(CombatFactListener.isPlayerHit(victim, source));
    }

    @Test
    void aProjectileWithNoShooterStaysTheProjectile() {
        Entity arrow = fake(Projectile.class, Map.<String, Object>of());
        Entity zombie = fake(LivingEntity.class, Map.<String, Object>of());

        assertSame(arrow, CombatFactListener.shooterOf(arrow));
        assertSame(zombie, CombatFactListener.shooterOf(zombie));
    }

    @Test
    void aProjectileShotByADispenserStaysTheProjectile() {
        BlockProjectileSource dispenser = fake(BlockProjectileSource.class, Map.<String, Object>of());
        Entity arrow = fake(Projectile.class, Map.<String, Object>of("getShooter", dispenser));

        assertSame(arrow, CombatFactListener.shooterOf(arrow));
    }

    @Test
    void aSkeletonsArrowHittingAPlayerIsOneSkeletonEncounter() {
        Entity skeleton = fake(
                LivingEntity.class,
                Map.<String, Object>of("getType", EntityType.SKELETON, "getUniqueId", UUID.fromString(SKELETON_UUID)));
        Entity arrow = fake(
                Projectile.class,
                Map.<String, Object>of(
                        "getType", EntityType.ARROW, "getUniqueId", UUID.fromString(ARROW_UUID), "getShooter", skeleton));
        Entity player = fake(
                Player.class, Map.<String, Object>of("getName", LIFE, "getUniqueId", UUID.fromString(PLAYER_UUID)));

        listener.damage(player, arrow, 10);
        now.set(300);
        listener.tick();

        assertEquals(1, mem.events().size());
        assertEquals("fight_survived", mem.events().get(0).payload().get("kind").getAsString());
        assertEquals("skeleton", mem.events().get(0).payload().get("mob").getAsString());
        assertEquals(
                "enc:" + LIFE + ":" + SKELETON_UUID,
                mem.events().get(0).payload().get("encounter_key").getAsString());
    }

    @Test
    void aPlayersArrowHittingAZombieSendsOneEngagedMessage() {
        World world = fake(World.class, Map.<String, Object>of("getName", "world"));
        Entity player = fake(
                Player.class,
                Map.<String, Object>of(
                        "getName", LIFE, "getUniqueId", UUID.fromString(PLAYER_UUID), "getWorld", world));
        Entity zombie = fake(
                LivingEntity.class,
                Map.<String, Object>of("getType", EntityType.ZOMBIE, "getUniqueId", UUID.fromString(MOB_UUID)));
        Entity arrow = fake(Projectile.class, Map.<String, Object>of("getShooter", player));

        listener.damage(zombie, arrow, 5);
        listener.damage(zombie, arrow, 6);

        assertEquals(List.of("combat " + ProvenanceJson.combatJson("world", LIFE, "zombie", "engaged", 5)), sent);
    }

    @Test
    void aPlayerHittingAPlayerThroughTheHandlerSeamIsNeitherAHurtNorAHit() {
        Entity attacker = fake(
                Player.class, Map.<String, Object>of("getName", LIFE, "getUniqueId", UUID.fromString(PLAYER_UUID)));
        Entity victim = fake(
                Player.class, Map.<String, Object>of("getName", LIFE, "getUniqueId", UUID.fromString(MOB_UUID)));

        listener.damage(victim, attacker, 10);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
        assertTrue(sent.isEmpty());
    }

    @Test
    void aPlayersDeathThroughTheHandlerSeamClosesTheEncounter() {
        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        LivingEntity player = fake(
                Player.class,
                Map.<String, Object>of(
                        "getType", EntityType.PLAYER, "getName", LIFE, "getUniqueId", UUID.fromString(PLAYER_UUID)));

        listener.death(player, 20);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
    }

    @Test
    void aZombieWithNoKillerEmitsNothingAndALifeKillerEmitsOneKill() {
        LivingEntity noKiller = fake(
                LivingEntity.class,
                Map.<String, Object>of("getType", EntityType.ZOMBIE, "getUniqueId", UUID.fromString(MOB_UUID)));
        listener.death(noKiller, 20);
        assertTrue(mem.events().isEmpty());

        listener.playerHurt(LIFE, PLAYER_UUID, MOB_UUID, "zombie", 10);
        LivingEntity killed = fake(
                LivingEntity.class,
                Map.<String, Object>of(
                        "getType",
                        EntityType.ZOMBIE,
                        "getUniqueId",
                        UUID.fromString(MOB_UUID),
                        "getKiller",
                        fake(Player.class, Map.<String, Object>of("getName", LIFE, "getUniqueId", UUID.fromString(PLAYER_UUID)))));
        listener.death(killed, 20);

        assertEquals(1, mem.events().size());
        assertEquals("hostile_kill", mem.events().get(0).payload().get("kind").getAsString());
    }

    @Test
    void theHandlerSeamsDoNothingWhileDisabledAndReadNoEntity() {
        enabled.set(false);
        listener.damage(tripwire(Player.class), tripwire(Projectile.class), 10);
        listener.death(tripwire(LivingEntity.class), 20);
        listener.death(tripwire(Player.class), 20);
        now.set(500);
        listener.tick();

        assertTrue(mem.events().isEmpty());
        assertTrue(sent.isEmpty());
    }

    @Test
    void bothDamageHandlersAreMonitorAndIgnoreCancelled() throws NoSuchMethodException {
        assertMonitorIgnoreCancelled(
                CombatFactListener.class.getMethod("onDamageByEntity", EntityDamageByEntityEvent.class));
        assertMonitorIgnoreCancelled(CombatFactListener.class.getMethod("onDeath", EntityDeathEvent.class));
    }

    private static void assertMonitorIgnoreCancelled(Method handler) {
        EventHandler annotation = handler.getAnnotation(EventHandler.class);
        assertNotNull(annotation, handler.getName());
        assertEquals(EventPriority.MONITOR, annotation.priority(), handler.getName());
        assertTrue(annotation.ignoreCancelled(), handler.getName());
    }

    private static final String SCHEMA_BASE = "https://geldar.dev/schemas/";
    private static final Schema COMBAT_FACT = loadCombatFactSchema();

    private static Schema loadCombatFactSchema() {
        Path dir = Path.of(System.getProperty("geldar.schemas")).toAbsolutePath().normalize();
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
                SpecificationVersion.DRAFT_2020_12,
                builder -> builder.schemas(id -> readSchema(dir, id))
                        .schemaRegistryConfig(
                                SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));
        return registry.getSchema(SchemaLocation.of(SCHEMA_BASE + "combat-fact-event.schema.json"));
    }

    /** The schema text for a geldar.dev schema id, read from the contract directory; null for other ids. */
    private static String readSchema(Path dir, String id) {
        if (!id.startsWith(SCHEMA_BASE)) {
            return null;
        }
        try {
            return Files.readString(dir.resolve(id.substring(SCHEMA_BASE.length())));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Schema errors for an emitted combat_fact payload against combat-fact-event.schema.json; empty when valid. */
    private static List<Error> payloadErrors(JsonObject payload) {
        return COMBAT_FACT.validate(payload.toString(), InputFormat.JSON);
    }

    /** A proxy that throws on any call: a seam that reads an entity while disabled fails the test. */
    private static <T> T tripwire(Class<T> type) {
        return type.cast(Proxy.newProxyInstance(
                CombatFactListenerTest.class.getClassLoader(),
                new Class<?>[] {type},
                (proxy, method, args) -> {
                    throw new IllegalStateException("entity read while disabled: " + method.getName());
                }));
    }

    /** A proxy that answers the named methods from {@code values} and null for the rest. */
    private static <T> T fake(Class<T> type, Map<String, Object> values) {
        return type.cast(Proxy.newProxyInstance(
                CombatFactListenerTest.class.getClassLoader(),
                new Class<?>[] {type},
                (proxy, method, args) -> values.get(method.getName())));
    }
}
