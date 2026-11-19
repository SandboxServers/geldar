package dev.geldar.core.combat;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Turns player and hostile-mob fights into combat facts (AN-47a, decisions D-CS-04 and 0321).
 *
 * <p>An encounter is one (player, mob entity UUID) pair. Its fact key is {@code enc:<player>:<mob uuid lowercase>},
 * the same key a completed kill pays from the Body (AN-47b). A kill and a survive of one encounter pay once: a closed
 * key is never emitted again. Only the killer is credited with a kill, never an assist.
 *
 * <p>Not thread-safe: the plugin calls it from the server thread only. The UUID arguments are accepted as the listener
 * has them; the key is built from the player's name (a life id) and the mob's UUID.
 */
public final class EncounterTracker {
    public static final int FIGHT_END_TICKS = 200;
    public static final int MAX_OPEN = 512;
    private static final int MAX_CLOSED = 512;

    /** A closed encounter. kind is hostile_kill or fight_survived. */
    public record Fact(String kind, String player, String mob, String encounterKey) {}

    /** The first engagement of an encounter. kind is always engaged. */
    public record Step(String kind, String player, String mob) {}

    /** Open encounters by slot, oldest opened first (a touch does not move an encounter). */
    private final Map<String, Encounter> open = new LinkedHashMap<>();
    /** Keys already closed, oldest first; the last MAX_CLOSED are remembered. */
    private final Set<String> closed = new LinkedHashSet<>();

    /** A player took hostile damage from a mob. Opens the encounter if needed and refreshes its timer. */
    public void playerHurtByMob(String player, String playerUuid, String mobUuid, String mobType, long tick) {
        touch(player, mobUuid, mobType, tick);
    }

    /**
     * A player damaged a hostile mob. Returns engaged once per encounter, on the player's first hit, even if the mob
     * hurt the player first (hurt then hit still engages once). Empty after that, and empty for a closed encounter.
     */
    public Optional<Step> playerHitMob(String player, String playerUuid, String mobUuid, String mobType, long tick) {
        Encounter e = touch(player, mobUuid, mobType, tick);
        if (e == null || e.engaged) {
            return Optional.empty();
        }
        e.engaged = true;
        return Optional.of(new Step("engaged", player, mobType));
    }

    /**
     * A mob died. A non-null killer gets one hostile_kill for its encounter (opened if needed); every other open
     * encounter on this mob closes as fight_survived. The killer's own encounter is listed first.
     */
    public List<Fact> mobDied(String mobUuid, String mobType, String killer, String killerUuid, long tick) {
        String mob = mobUuid.toLowerCase(Locale.ROOT);
        Encounter killerEncounter = killer == null ? null : touch(killer, mob, mobType, tick);
        List<Fact> facts = new ArrayList<>();
        if (killerEncounter != null) {
            facts.add(close(killerEncounter, "hostile_kill"));
        }
        for (Encounter e : List.copyOf(open.values())) {
            if (e.mob.equals(mob)) {
                facts.add(close(e, "fight_survived"));
            }
        }
        return facts;
    }

    /** A player died. Their encounters close with no fact. */
    public void playerDied(String player, long tick) {
        for (Encounter e : List.copyOf(open.values())) {
            if (e.player.equals(player)) {
                open.remove(e.slot);
                rememberClosed(e.key());
            }
        }
    }

    /** Closes, as fight_survived, each encounter with no damage either way for more than FIGHT_END_TICKS ticks. */
    public List<Fact> advance(long tick) {
        List<Fact> facts = new ArrayList<>();
        for (Encounter e : List.copyOf(open.values())) {
            if (tick - e.lastTick > FIGHT_END_TICKS) {
                facts.add(close(e, "fight_survived"));
            }
        }
        return facts;
    }

    /**
     * The open encounter for (player, mob), opened if it is new. Null when the key is already closed, so a closed
     * encounter never reopens and never emits again. A new encounter at MAX_OPEN drops the oldest open one: oldest means
     * oldest opened, not least recently active. A dropped key is not remembered as closed, so a fight still going on
     * opens fresh and can still pay once.
     */
    private Encounter touch(String player, String mobUuid, String mobType, long tick) {
        String mob = mobUuid.toLowerCase(Locale.ROOT);
        String slot = player + "|" + mob;
        Encounter e = open.get(slot);
        if (e == null) {
            if (closed.contains(encounterKey(player, mob))) {
                return null;
            }
            if (open.size() >= MAX_OPEN) {
                Encounter oldest = open.values().iterator().next();
                open.remove(oldest.slot);
            }
            e = new Encounter(slot, player, mob, mobType);
            open.put(slot, e);
        }
        e.lastTick = tick;
        return e;
    }

    private Fact close(Encounter e, String kind) {
        open.remove(e.slot);
        rememberClosed(e.key());
        return new Fact(kind, e.player, e.mobType, e.key());
    }

    private void rememberClosed(String key) {
        closed.add(key);
        Iterator<String> oldest = closed.iterator();
        while (closed.size() > MAX_CLOSED) {
            oldest.next();
            oldest.remove();
        }
    }

    private static String encounterKey(String player, String mob) {
        return "enc:" + player + ":" + mob;
    }

    /** Mutable state of one open encounter. mob is lowercase. */
    private static final class Encounter {
        final String slot;
        final String player;
        final String mob;
        final String mobType;
        long lastTick;
        boolean engaged;

        Encounter(String slot, String player, String mob, String mobType) {
            this.slot = slot;
            this.player = player;
            this.mob = mob;
            this.mobType = mobType;
        }

        String key() {
            return encounterKey(player, mob);
        }
    }
}
