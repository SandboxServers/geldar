package dev.geldar.core;

import com.google.gson.JsonObject;
import dev.geldar.core.blockowner.ProvenanceSink;
import dev.geldar.core.combat.EncounterTracker;
import dev.geldar.core.combat.EncounterTracker.Fact;
import dev.geldar.core.combat.HostileMobs;
import dev.geldar.core.provenance.ProvenanceJson;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDeathEvent;

/**
 * Turns Paper combat events into combat facts (AN-47a part 2). {@link EncounterTracker} decides what is a fact;
 * this class reads the events, filters them, and emits. GeldarCore registers it; it is inert until provenance.enabled is true.
 */
public final class CombatFactListener implements Listener {
    private final EventExporter exporter;
    private final ProvenanceSink sink;
    private final BooleanSupplier enabled;
    private final LongSupplier worldTick;
    private final EncounterTracker tracker = new EncounterTracker();

    /** {@code enabled} gates everything; {@code tick} is the world tick used for encounter timing. */
    public CombatFactListener(EventExporter exporter, ProvenanceSink sink, BooleanSupplier enabled, LongSupplier tick) {
        this.exporter = exporter;
        this.sink = sink;
        this.enabled = enabled;
        this.worldTick = tick;
    }

    /** A player hurt by a hostile mob, or a player hitting one. Players hitting players are not combat facts. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamageByEntity(EntityDamageByEntityEvent event) {
        damage(event.getEntity(), event.getDamager(), worldTick.getAsLong());
    }

    /** Package-private seam: the logic of {@link #onDamageByEntity}, with the event's entities as arguments. */
    void damage(Entity victim, Entity damager, long now) {
        if (!enabled.getAsBoolean()) {
            return;
        }
        Entity source = shooterOf(damager);
        if (isPlayerHurt(victim, source)) {
            Player hurt = (Player) victim;
            playerHurt(
                    hurt.getName(),
                    hurt.getUniqueId().toString(),
                    source.getUniqueId().toString(),
                    mobType(source),
                    now);
        } else if (isPlayerHit(victim, source)) {
            Player hitter = (Player) source;
            playerHit(
                    hitter.getWorld().getName(),
                    hitter.getName(),
                    hitter.getUniqueId().toString(),
                    victim.getUniqueId().toString(),
                    mobType(victim),
                    now);
        }
    }

    /** A projectile counts as the entity that shot it, so an arrow from a skeleton is the skeleton's hit. */
    static Entity shooterOf(Entity damager) {
        if (damager instanceof Projectile projectile && projectile.getShooter() instanceof Entity shooter) {
            return shooter;
        }
        return damager;
    }

    /** A player was hurt by something that is not a player. */
    static boolean isPlayerHurt(Entity victim, Entity source) {
        return victim instanceof Player && !(source instanceof Player);
    }

    /** A player hit something that is not a player. */
    static boolean isPlayerHit(Entity victim, Entity source) {
        return source instanceof Player && !(victim instanceof Player);
    }

    /** A mob died (possibly to a player) or a player died (closes that player's encounters with no fact). */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(EntityDeathEvent event) {
        death(event.getEntity(), worldTick.getAsLong());
    }

    /** Package-private seam: the logic of {@link #onDeath}. */
    void death(LivingEntity dead, long now) {
        if (!enabled.getAsBoolean()) {
            return;
        }
        if (dead instanceof Player player) {
            playerDied(player.getName(), now);
            return;
        }
        Player killer = dead.getKiller();
        mobDied(
                dead.getUniqueId().toString(),
                mobType(dead),
                killer == null ? null : killer.getName(),
                killer == null ? null : killer.getUniqueId().toString(),
                now);
    }

    /** Scheduled once per server tick: closes the encounters that have gone quiet. */
    public void tick() {
        if (!enabled.getAsBoolean()) {
            return;
        }
        emit(tracker.advance(worldTick.getAsLong()));
    }

    /** Package-private seam: the logic of {@link #onDamageByEntity}, with the entity reads already done. */
    void playerHurt(String player, String playerUuid, String mobUuid, String mobType, long now) {
        if (!enabled.getAsBoolean() || !EventEnvelope.isLifeId(player) || !HostileMobs.isHostile(mobType)) {
            return;
        }
        tracker.playerHurtByMob(player, playerUuid, mobUuid, mobType, now);
    }

    /** Package-private seam: a player hitting a hostile mob; the first hit of an encounter sends {@code engaged}. */
    void playerHit(String world, String player, String playerUuid, String mobUuid, String mobType, long now) {
        if (!enabled.getAsBoolean() || !EventEnvelope.isLifeId(player) || !HostileMobs.isHostile(mobType)) {
            return;
        }
        tracker.playerHitMob(player, playerUuid, mobUuid, mobType, now)
                .ifPresent(step -> sink.send(
                        "combat", ProvenanceJson.combatJson(world, step.player(), step.mob(), "engaged", now)));
    }

    /** Package-private seam: a hostile mob died. A killer that is not a life id counts as no killer. */
    void mobDied(String mobUuid, String mobType, String killer, String killerUuid, long now) {
        if (!enabled.getAsBoolean() || !HostileMobs.isHostile(mobType)) {
            return;
        }
        boolean lifeKiller = EventEnvelope.isLifeId(killer);
        emit(tracker.mobDied(
                mobUuid, mobType, lifeKiller ? killer : null, lifeKiller ? killerUuid : null, now));
    }

    /** Package-private seam: a player died. */
    void playerDied(String player, long now) {
        if (!enabled.getAsBoolean() || !EventEnvelope.isLifeId(player)) {
            return;
        }
        tracker.playerDied(player, now);
    }

    private static String mobType(Entity entity) {
        return entity.getType().getKey().getKey();
    }

    private void emit(List<Fact> facts) {
        for (Fact fact : facts) {
            JsonObject payload = new JsonObject();
            payload.addProperty("life_id", fact.player());
            payload.addProperty("kind", fact.kind());
            payload.addProperty("mob", fact.mob());
            payload.addProperty("encounter_key", fact.encounterKey());
            exporter.emit("combat_fact", fact.player(), payload);
        }
    }
}
