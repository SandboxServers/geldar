package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
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

    private static PlayerDeathEvent death(Player player) {
        return new PlayerDeathEvent(player, SOURCE, new ArrayList<>(), 0, Component.empty(), true);
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
