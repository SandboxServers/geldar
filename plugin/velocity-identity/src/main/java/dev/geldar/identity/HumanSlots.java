package dev.geldar.identity;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The concurrent-human cap (spec 8.4, decision 0137): at most {@link #CAP} human connections hold a slot at once.
 * Agents never take one; they come through the agent lane. A human reserves its slot at the login decision and gives
 * it back on disconnect, or when its login is refused after the reservation.
 *
 * <p>A slot belongs to the connection object that reserved it (its owner), not to its UUID. A second login of a UUID
 * that already holds a slot is refused, so it never shares, replaces or frees the holder's slot. Only the owner gives
 * the slot back. Every method is synchronized on this map, so simultaneous logins cannot overshoot the cap.
 */
final class HumanSlots {
    /** The most concurrent human connections the proxy admits. Not configurable: the cap is a plugin rule. */
    static final int CAP = 5;

    /** The result of a reservation. {@link #NEW} is the only one that gives the caller a slot to give back. */
    enum Outcome { FULL, TAKEN, NEW }

    /** Each held slot, by its owner. Owners compare by identity, so two connections of one UUID are two owners. */
    private final Map<Object, UUID> owners = new IdentityHashMap<>();

    /** Reserves a slot for this owner. A full cap refuses; so does a UUID that already holds a slot ({@link Outcome#TAKEN}). */
    synchronized Outcome reserve(Object owner, UUID connection) {
        if (owners.containsValue(connection)) {
            return Outcome.TAKEN;
        }
        if (owners.size() >= CAP) {
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
