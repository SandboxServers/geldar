package dev.geldar.identity;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.UUID;

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
 * the slot back. Every method is synchronized on this map, so simultaneous logins cannot overshoot the capacity.
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

    /** Reserves a slot for this owner. A full shard refuses; so does a UUID that already holds a slot ({@link Outcome#TAKEN}). */
    synchronized Outcome reserve(Object owner, UUID connection) {
        if (owners.containsValue(connection)) {
            return Outcome.TAKEN;
        }
        if (owners.size() >= SHARD_MAX_PLAYERS) {
            return Outcome.FULL;
        }
        owners.put(owner, connection);
        return Outcome.NEW;
    }

    /** Gives back the slot this owner holds. An owner that holds nothing, or already gave it back, does nothing. */
    synchronized void release(Object owner) {
        owners.remove(owner);
    }
}
