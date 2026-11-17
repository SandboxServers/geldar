package dev.geldar.ledger.paper.curated;

import com.destroystokyo.paper.event.player.PlayerPostRespawnEvent;
import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.player.PlayerTeleportEvent.TeleportCause;

/**
 * Combat, deaths and coarse movement (PT-07c). Only enum names, a clamped damage number and world names leave the
 * server. No coordinates are exported: a death, a teleport or a respawn does not carry where the player was. Nothing here
 * reads a death message (free text that names players), a display name, an address, an item or a location. Never
 * registers {@code PlayerMoveEvent}: nothing is exported per tick.
 *
 * <p>s1 is a {@code geldar.life_id} when the player is a Geldar life, else null (a human carries no name). Role code in
 * {@code geldar.role} of {@code geldar.combat.damage}: 1 a player was hurt by a non-player, 2 a player hurt a non-player,
 * 3 a player hurt a player. The extractors are static and take plain values; the lambdas in {@link #register} that pull
 * those values out of the Bukkit events are compile-only (an event cannot be built without a server).
 */
public final class CombatMovementFamily implements CuratedFamily {
    /** Largest exported damage, x100 (10 000 hearts of damage is already far beyond any real hit). */
    static final long MAX_DAMAGE_X100 = 1_000_000L;

    static final int ROLE_VICTIM = 1;
    static final int ROLE_ATTACKER = 2;
    static final int ROLE_BOTH = 3;
    static final String UNKNOWN = "UNKNOWN";

    private static final String C = Names.Events.COMBAT_FAMILY + ".";
    private static final String M = Names.Events.MOVEMENT_FAMILY + ".";
    private static final String[] DAMAGE_FIELDS = {
        AttrKeys.AMOUNT, AttrKeys.ROLE, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, null
    };
    private static final String[] DEATH_FIELDS = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, AttrKeys.WORLD};
    private static final String[] KILL_FIELDS = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE, null};
    private static final String[] LIFE_ONLY = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, AttrKeys.WORLD};
    private static final String[] TELEPORT_FIELDS = {
        null, null, AttrKeys.FLAG, AttrKeys.LIFE_ID, AttrKeys.CAUSE, AttrKeys.WORLD
    };

    @Override
    public void register(CuratedRegistry r) {
        // EntityDamageByEntityEvent shares EntityDamageEvent's handler list: one registration sees both (no double count).
        r.on(EntityDamageEvent.class, C + "damage", Severity.INFO, DAMAGE_FIELDS, true, (e, s) -> {
            Entity damager = e instanceof EntityDamageByEntityEvent be ? be.getDamager() : null;
            damage(s, e.getEntity(), damager, e.getFinalDamage(), e.getCause());
        });
        r.on(PlayerDeathEvent.class, C + "player_death", Severity.INFO, DEATH_FIELDS, true, (e, s) -> {
            Player p = e.getEntity();
            EntityDamageEvent last = p.getLastDamageCause(); // the cause enum only; getDeathMessage is never called
            death(s, p, last == null ? null : last.getCause(), p.getWorld());
        });
        r.on(EntityDeathEvent.class, C + "kill", Severity.INFO, KILL_FIELDS, true, (e, s) ->
                kill(s, e.getEntity().getKiller(), e.getEntityType().name()));
        r.on(PlayerRespawnEvent.class, C + "respawn", Severity.INFO, LIFE_ONLY, true, (e, s) ->
                named(s, e.getPlayer(), e.getRespawnReason().name(), e.getPlayer().getWorld()));
        r.on(PlayerPostRespawnEvent.class, C + "post_respawn", Severity.INFO, LIFE_ONLY, true, (e, s) ->
                named(s, e.getPlayer(), null, e.getPlayer().getWorld()));
        r.on(PlayerTeleportEvent.class, M + "teleport", Severity.INFO, TELEPORT_FIELDS, true, (e, s) -> {
            if (e instanceof PlayerPortalEvent) { // may reach this executor through a shared handler list
                s.skip();
                return;
            }
            porting(s, e.getPlayer(), e.getCause(), e.getPlayer().getWorld());
        });
        r.on(PlayerChangedWorldEvent.class, M + "world_change", Severity.INFO, LIFE_ONLY, true, (e, s) ->
                named(s, e.getPlayer(), e.getFrom().getName(), e.getPlayer().getWorld()));
        r.on(PlayerPortalEvent.class, M + "portal", Severity.INFO, LIFE_ONLY, true, (e, s) ->
                named(s, e.getPlayer(), e.getCause().name(), e.getTo() == null ? null : e.getTo().getWorld()));
        r.on(PlayerGameModeChangeEvent.class, M + "gamemode", Severity.INFO, LIFE_ONLY, true, (e, s) ->
                named(s, e.getPlayer(), e.getNewGameMode().name(), e.getPlayer().getWorld()));
    }

    /** Final damage x100, clamped to [0, MAX_DAMAGE_X100]; NaN and negatives are 0. */
    static long damageX100(double finalDamage) {
        if (!(finalDamage > 0)) {
            return 0;
        }
        double scaled = finalDamage * 100;
        return scaled >= MAX_DAMAGE_X100 ? MAX_DAMAGE_X100 : (long) scaled;
    }

    /** Records a damage event only when a player is the victim or the (direct or projectile) damager. */
    static void damage(FieldSink s, Entity victim, Entity damager, double finalDamage, DamageCause cause) {
        Player hurt = victim instanceof Player p ? p : null;
        Player hurter = null;
        if (damager instanceof Player p) {
            hurter = p;
        } else if (damager instanceof Projectile proj && proj.getShooter() instanceof Player p) {
            hurter = p;
        }
        if (hurt == null && hurter == null) {
            s.skip();
            return;
        }
        s.l1 = damageX100(finalDamage);
        s.l2 = hurt != null && hurter != null ? ROLE_BOTH : hurt != null ? ROLE_VICTIM : ROLE_ATTACKER;
        s.player(hurt != null ? hurt : hurter);
        s.s2 = cause == null ? UNKNOWN : cause.name();
    }

    static void death(FieldSink s, Player dead, DamageCause cause, World world) {
        s.player(dead);
        s.s2 = cause == null ? UNKNOWN : cause.name();
        s.s3 = world == null ? null : world.getName();
    }

    /** A kill counts only with a player killer; s2 is the victim's entity type enum name. */
    static void kill(FieldSink s, Player killer, String victimType) {
        if (killer == null) {
            s.skip();
            return;
        }
        s.player(killer);
        s.s2 = victimType;
    }

    /** l3 = 1 for cause COMMAND (the operator signal), else 0. */
    static void porting(FieldSink s, Player p, TeleportCause cause, World world) {
        s.player(p);
        s.s2 = cause == null ? UNKNOWN : cause.name();
        s.l3 = cause == TeleportCause.COMMAND ? 1 : 0;
        s.s3 = world == null ? null : world.getName();
    }

    /** Life id, one bounded name (an enum or a world name) in s2 and a world name in s3. */
    static void named(FieldSink s, Player p, String name, World world) {
        s.player(p);
        s.s2 = name;
        s.s3 = world == null ? null : world.getName();
    }
}
