package dev.geldar.identity;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * The concurrent-human cap (spec 8.4, decision 0137): at most {@link #CAP} human connections hold a slot at once.
 * Agents never take one; they come through the agent lane. A human reserves its slot at the login decision and gives
 * it back on disconnect, or when its login is refused after the reservation. A UUID holds one slot however many logins
 * it makes. Every method is synchronized on this set, so simultaneous logins cannot overshoot the cap.
 */
final class HumanSlots {
    /** The most concurrent human connections the proxy admits. Not configurable: the cap is a plugin rule. */
    static final int CAP = 5;

    /** The result of a reservation. {@link #NEW} is the only one that gives the caller a slot to give back. */
    enum Outcome { FULL, HELD, NEW }

    private final Set<UUID> held = new HashSet<>();

    /** Reserves a slot for this UUID. A UUID that already holds one shares it; a full cap refuses a new UUID. */
    synchronized Outcome reserve(UUID connection) {
        if (held.contains(connection)) {
            return Outcome.HELD;
        }
        if (held.size() >= CAP) {
            return Outcome.FULL;
        }
        held.add(connection);
        return Outcome.NEW;
    }

    /** Gives back the slot of this UUID. Releasing a UUID that holds nothing does nothing. */
    synchronized void release(UUID connection) {
        held.remove(connection);
    }
}
