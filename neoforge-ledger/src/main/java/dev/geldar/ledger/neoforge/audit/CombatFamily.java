package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.function.Supplier;

/**
 * Combat and deaths (PT-N8), the NeoForge twin of the Paper combat family. Plain values in, so it is testable without a
 * server; the code that reads the game events is {@link AuditWiring}. Only enum-like names, a clamped damage number and
 * a dimension name leave the server: no coordinates, no death message, no display name. A player name is exported only
 * when it is a life id ({@link LifeIds#isLifeId}); a human is never named.
 *
 * <p>Role of {@code geldar.combat.damage}: 1 a player was hurt by a non-player, 2 a player hurt a non-player, 3 a player
 * hurt a player. A player-versus-player hit keeps the victim only (D-B). {@code kill} is for non-player victims only
 * (D-C); a player death is {@code player_death} and nothing else.
 */
public final class CombatFamily {
    static final long MAX_DAMAGE_X100 = 1_000_000L;
    static final int ROLE_VICTIM = 1;
    static final int ROLE_ATTACKER = 2;
    static final int ROLE_BOTH = 3;
    static final String UNKNOWN = "UNKNOWN";
    private static final int RATE = 20;

    private static final String[] DAMAGE_FIELDS = {
        AttrKeys.AMOUNT, AttrKeys.ROLE, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, null
    };
    private static final String[] DEATH_FIELDS = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, AttrKeys.WORLD};
    private static final String[] KILL_FIELDS = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE, null};

    private final EventLog events;
    private final Guarded guarded;
    private final int damageId;
    private final int deathId;
    private final int killId;

    public CombatFamily(Ledger ledger, HostInfo host) {
        this.events = ledger.events();
        this.guarded = new Guarded(ledger.guard("combat"), host);
        String c = Names.Events.COMBAT_FAMILY + ".";
        this.damageId = events.register(c + "damage", Severity.INFO, RATE, DAMAGE_FIELDS);
        this.deathId = events.register(c + "player_death", Severity.INFO, RATE, DEATH_FIELDS);
        this.killId = events.register(c + "kill", Severity.INFO, RATE, KILL_FIELDS);
    }

    long errors() {
        return guarded.errors();
    }

    /** Final damage x100, clamped to [0, MAX_DAMAGE_X100]; NaN and negatives are 0. */
    static long damageX100(double finalDamage) {
        if (!(finalDamage > 0)) {
            return 0;
        }
        double scaled = finalDamage * 100;
        return scaled >= MAX_DAMAGE_X100 ? MAX_DAMAGE_X100 : (long) scaled;
    }

    static String lifeId(String name) {
        return name != null && LifeIds.isLifeId(name) ? name : null;
    }

    /** {@code null} stands for a victim or attacker that is not a player. Neither a player: nothing is recorded. */
    public void damage(String victimPlayer, String attackerPlayer, double finalDamage, String cause) {
        guarded.runMain(() -> {
            if (victimPlayer == null && attackerPlayer == null) {
                return;
            }
            boolean both = victimPlayer != null && attackerPlayer != null;
            long role = both ? ROLE_BOTH : victimPlayer != null ? ROLE_VICTIM : ROLE_ATTACKER;
            String who = victimPlayer != null ? victimPlayer : attackerPlayer; // victim only for pvp (D-B)
            events.record(damageId, damageX100(finalDamage), role, 0, lifeId(who), cause(cause), null);
        });
    }

    public void playerDeath(String player, String cause, String dimension) {
        guarded.runMain(() -> events.record(deathId, 0, 0, 0, lifeId(player), cause(cause), dimension));
    }

    /** A kill counts only for a player killer and a non-player victim (D-C); s2 is the victim's entity type name. */
    public void killed(String killerPlayer, boolean victimIsPlayer, Supplier<String> victimType) {
        guarded.runMain(() -> {
            if (killerPlayer == null || victimIsPlayer) {
                return; // the type string is not built for a mob farm death with no player killer
            }
            events.record(killId, 0, 0, 0, lifeId(killerPlayer), victimType.get(), null);
        });
    }

    private static String cause(String cause) {
        return cause == null ? UNKNOWN : cause;
    }
}
