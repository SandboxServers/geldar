package dev.geldar.identity;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;

/**
 * The human slots of the NeoForge shard. A human reserves one at the login decision and gives it back on disconnect,
 * or when its login is refused after the reservation. Agents never take one; they come through the agent lane.
 *
 * <p>The capacity is {@link #SHARD_MAX_PLAYERS}, which equals the shard's MAX_PLAYERS of 100 (compose/nf-live.yml).
 * MAX_PLAYERS is the real limit on the shared total of humans and agents, enforced by the backend server; the slots
 * here only bound the humans and must never be smaller than that limit. Changing one means changing the other.
 *
 * <p>A slot belongs to the connection object that reserved it (its owner), not to its UUID. A second login of a UUID
 * that already holds a slot is refused, so it never shares, replaces or frees the holder's slot. Only the owner gives
 * the slot back. Every read and write of the map is under the lock on this object, so simultaneous logins cannot
 * overshoot the capacity. Each reservation and release logs one INFO line with the count held after it: no name, UUID
 * or IP is ever logged.
 */
final class HumanSlots {
    /**
     * The shard's shared player limit (MAX_PLAYERS 100), also the most human connections the proxy admits at once.
     * Not configurable: it is a plugin constant that must track MAX_PLAYERS in compose/nf-live.yml.
     */
    static final int SHARD_MAX_PLAYERS = 100;

    /** The result of a reservation. {@link #NEW} is the only one that gives the caller a slot to give back. */
    enum Outcome { FULL, TAKEN, NEW }

    /** Each held slot, by its owner. Owners compare by identity, so two connections of one UUID are two owners. */
    private final Map<Object, UUID> owners = new IdentityHashMap<>();
    /** Where the counts are logged. Null logs nothing. */
    private final Logger log;

    HumanSlots(Logger log) {
        this.log = log;
    }

    /** Reserves a slot for this owner. A full shard refuses; so does a UUID that already holds a slot ({@link Outcome#TAKEN}). */
    Outcome reserve(Object owner, UUID connection) {
        int held;
        synchronized (this) {
            if (owners.containsValue(connection)) {
                return Outcome.TAKEN;
            }
            if (owners.size() >= SHARD_MAX_PLAYERS) {
                return Outcome.FULL;
            }
            owners.put(owner, connection);
            held = owners.size();
        }
        count("human slot reserved: {}/{}", held);
        return Outcome.NEW;
    }

    /**
     * Gives back the slot this owner holds, and returns true. An owner that holds nothing, or already gave it back, does
     * nothing and returns false.
     */
    boolean release(Object owner) {
        int held;
        synchronized (this) {
            if (owners.remove(owner) == null) {
                return false;
            }
            held = owners.size();
        }
        count("human slot released: {}/{}", held);
        return true;
    }

    /** One INFO line with the count and the capacity. A logger that fails must not refuse a login or a disconnect. */
    private void count(String message, int held) {
        if (log == null) {
            return;
        }
        try {
            log.info(message, held, SHARD_MAX_PLAYERS);
        } catch (RuntimeException ignored) {
            // The slot is already reserved or released; the line is lost, the login decision stands.
        }
    }
}
