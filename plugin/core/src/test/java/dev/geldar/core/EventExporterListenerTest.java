package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerBedEnterEvent.BedEnterResult;
import org.junit.jupiter.api.Test;

/** The Bukkit handlers of {@link EventExporter}, driven with real event objects and Player doubles. */
class EventExporterListenerTest {
    private final InMemoryEventPublisher mem = new InMemoryEventPublisher();
    private final EventExporter exporter = new EventExporter(
            mem, "phase0", () -> 100, () -> Instant.parse("2026-11-09T00:00:00Z"), Logger.getLogger("test"));

    private static Player player(String name, EntityDamageEvent last) {
        return ListenerDoubles.player(name, List.of(), new ArrayList<>(), last);
    }

    /** The deprecated constructor without a source reads the damage-type registry, which needs a server. */
    private static final DamageSource SOURCE = (DamageSource) java.lang.reflect.Proxy.newProxyInstance(
            EventExporterListenerTest.class.getClassLoader(), new Class<?>[] {DamageSource.class}, (p, m, a) -> null);

    private static EntityDamageEvent damage(Entity victim, DamageCause cause, double amount) {
        return new EntityDamageEvent(victim, cause, SOURCE, amount);
    }

    @Test
    void damageToAPlayerIsExportedWithCauseAndAmount() {
        Player victim = player("ag_wren_02", null);
        exporter.onDamage(damage(victim, DamageCause.FALL, 4.0));
        EventEnvelope e = mem.events().get(0);
        assertEquals("geldar.phase0.damage", e.subject());
        assertEquals("ag_wren_02", e.agentId());
        assertEquals("FALL", e.payload().get("cause").getAsString());
        assertEquals(4.0, e.payload().get("amount").getAsDouble());
        assertTrue(EventSchemaCheck.errors(e).isEmpty());
    }

    @Test
    void damageToANonPlayerIsIgnored() {
        Object notAPlayer = java.lang.reflect.Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Entity.class}, (p, m, a) -> null);
        exporter.onDamage(damage((Entity) notAPlayer, DamageCause.FALL, 1.0));
        assertTrue(mem.events().isEmpty());
    }

    @Test
    void deathCarriesTheLastDamageCause() {
        Player self = player("ag_wren_02", null);
        Player dying = player("ag_wren_02", damage(self, DamageCause.DROWNING, 2.0));
        exporter.onDeath(death(dying));
        EventEnvelope e = mem.events().get(0);
        assertEquals("geldar.phase0.death", e.subject());
        assertEquals("DROWNING", e.payload().get("cause").getAsString());
    }

    @Test
    void deathWithoutADamageCauseSaysUnknown() {
        exporter.onDeath(death(player("ag_wren_02", null)));
        assertEquals("UNKNOWN", mem.events().get(0).payload().get("cause").getAsString());
    }

    @Test
    void deathCarriesBlockCoordinatesWhenTheLocationIsKnown() {
        Player dying = ListenerDoubles.player(
                "ag_wren_02", List.of(), new ArrayList<>(), null, new org.bukkit.Location(null, 10.7, 64.0, -3.2));
        exporter.onDeath(death(dying));
        EventEnvelope e = mem.events().get(0);
        assertEquals(10, e.payload().get("x").getAsInt());
        assertEquals(64, e.payload().get("y").getAsInt());
        assertEquals(-4, e.payload().get("z").getAsInt());
    }

    @Test
    void deathWithoutALocationStillEmitsWithNoCoordinates() {
        exporter.onDeath(death(player("ag_wren_02", null)));
        EventEnvelope e = mem.events().get(0);
        assertEquals("UNKNOWN", e.payload().get("cause").getAsString());
        assertTrue(!e.payload().has("x") && !e.payload().has("y") && !e.payload().has("z"));
        assertTrue(EventSchemaCheck.errors(e).isEmpty());
    }

    private static PlayerDeathEvent death(Player player) {
        return new PlayerDeathEvent(player, SOURCE, new ArrayList<>(), 0, Component.empty(), true);
    }

    /** Dies at block (10, 64, -4) in {@code world} with {@code bed} as the bed spawn; returns the payload. */
    private JsonObject diedIn(org.bukkit.World world, Location bed) {
        Player dying = ListenerDoubles.player("ag_wren_02", List.of(), new ArrayList<>(), null,
                new Location(null, 10.7, 64.0, -3.2), world, bed);
        exporter.onDeath(death(dying));
        return mem.events().get(mem.events().size() - 1).payload();
    }

    /** Stacks are Bukkit Materials, which need a server; the record list stands in for them here. */
    @Test
    void dropsListEachStackByItemNameCountAndDeathBlock() {
        JsonObject p = new JsonObject();
        EventExporter.addDrops(p,
                List.of(new EventExporter.Drop("oak_log", 3), new EventExporter.Drop("cobblestone", 12)),
                new Location(null, 10.7, 64.0, -3.2));
        JsonArray items = p.getAsJsonArray("drop_items");
        assertEquals(2, items.size());
        JsonObject first = items.get(0).getAsJsonObject();
        assertEquals("oak_log", first.get("item").getAsString());
        assertEquals(3, first.get("count").getAsInt());
        assertEquals(10, first.get("x").getAsInt());
        assertEquals(64, first.get("y").getAsInt());
        assertEquals(-4, first.get("z").getAsInt());
        assertEquals("cobblestone", items.get(1).getAsJsonObject().get("item").getAsString());
        assertEquals(12, items.get(1).getAsJsonObject().get("count").getAsInt());
        assertEquals(15, p.get("drops").getAsInt());
    }

    @Test
    void noDropsAddNoDropFields() {
        JsonObject p = new JsonObject();
        EventExporter.addDrops(p, List.of(), new Location(null, 1.0, 2.0, 3.0));
        assertTrue(!p.has("drops") && !p.has("drop_items"));
    }

    @Test
    void aDeathWithNoDropsHasNoDropFields() {
        exporter.onDeath(death(player("ag_wren_02", null)));
        JsonObject p = mem.events().get(0).payload();
        assertTrue(!p.has("drops") && !p.has("drop_items"));
    }

    @Test
    void dropsWithoutADeathLocationHaveNoCoordinates() {
        JsonObject p = new JsonObject();
        EventExporter.addDrops(p, List.of(new EventExporter.Drop("stone", 2)), null);
        JsonObject d = p.getAsJsonArray("drop_items").get(0).getAsJsonObject();
        assertEquals("stone", d.get("item").getAsString());
        assertTrue(!d.has("x") && !d.has("y") && !d.has("z"));
    }

    @Test
    void theDimensionIsNamedInTheContractsWords() {
        assertEquals("overworld", diedIn(ListenerDoubles.world(World.Environment.NORMAL, null), null)
                .get("dimension").getAsString());
        assertEquals("nether", diedIn(ListenerDoubles.world(World.Environment.NETHER, null), null)
                .get("dimension").getAsString());
        assertEquals("end", diedIn(ListenerDoubles.world(World.Environment.THE_END, null), null)
                .get("dimension").getAsString());
        assertEquals("other", diedIn(ListenerDoubles.world(World.Environment.CUSTOM, null), null)
                .get("dimension").getAsString());
        assertEquals("other", diedIn(null, null).get("dimension").getAsString());
    }

    @Test
    void theBedIsTheRespawnPointWhenThereIsOne() {
        JsonObject p = diedIn(ListenerDoubles.world(World.Environment.NORMAL, new Location(null, 0, 60, 0)),
                new Location(null, 100.5, 70.0, 200.9));
        assertEquals(100, p.get("respawn_x").getAsInt());
        assertEquals(70, p.get("respawn_y").getAsInt());
        assertEquals(200, p.get("respawn_z").getAsInt());
    }

    @Test
    void theWorldSpawnIsTheRespawnPointWithoutABed() {
        JsonObject p = diedIn(ListenerDoubles.world(World.Environment.NORMAL, new Location(null, -5, 80, 7)), null);
        assertEquals(-5, p.get("respawn_x").getAsInt());
        assertEquals(80, p.get("respawn_y").getAsInt());
        assertEquals(7, p.get("respawn_z").getAsInt());
    }

    @Test
    void noRespawnPointIsStatedWhenNeitherIsKnown() {
        JsonObject p = diedIn(null, null);
        assertTrue(!p.has("respawn_x") && !p.has("respawn_y") && !p.has("respawn_z"));
    }

    @Test
    void onlyASuccessfulBedEntryIsSleep() {
        Player p = player("ag_wren_02", null);
        exporter.onSleep(new PlayerBedEnterEvent(p, null, BedEnterResult.NOT_SAFE, null));
        assertTrue(mem.events().isEmpty());
        exporter.onSleep(new PlayerBedEnterEvent(p, null, BedEnterResult.OK, null));
        assertEquals("geldar.phase0.sleep", mem.events().get(0).subject());
    }

    /** Without @EventHandler Bukkit never calls the method; priority and ignoreCancelled are part of the contract. */
    @Test
    void handlersAreRegisteredWithTheIntendedPriorities() throws NoSuchMethodException {
        assertHandler(EventExporter.class, "onDamage", EntityDamageEvent.class, EventPriority.MONITOR, true);
        assertHandler(EventExporter.class, "onDeath", PlayerDeathEvent.class, EventPriority.MONITOR, false);
        assertHandler(EventExporter.class, "onSleep", PlayerBedEnterEvent.class, EventPriority.MONITOR, false);
        assertHandler(RecipeGrantListener.class, "onJoin", org.bukkit.event.player.PlayerJoinEvent.class,
                EventPriority.NORMAL, false);
        assertHandler(CommandBlockListener.class, "onCommand",
                org.bukkit.event.player.PlayerCommandPreprocessEvent.class, EventPriority.HIGHEST, false);
    }

    private static void assertHandler(
            Class<?> type, String name, Class<? extends Event> event, EventPriority priority, boolean ignoreCancelled)
            throws NoSuchMethodException {
        Method m = type.getMethod(name, event);
        EventHandler h = m.getAnnotation(EventHandler.class);
        assertTrue(h != null, name + " lacks @EventHandler");
        assertEquals(priority, h.priority(), name + " priority");
        assertEquals(ignoreCancelled, h.ignoreCancelled(), name + " ignoreCancelled");
    }
}
