package dev.geldar.identity;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The bot-ingress decision (spec Appendix F, 8.4): a username is admitted only when the registry has
 * synced at least once and holds a valid entry for it. Everything else, including "never synced",
 * is denied with the same fixed message, so a denial reveals nothing about which check failed.
 *
 * <p>An admitted name is either {@link Admission#LIVE} (a registered life that is live) or
 * {@link Admission#SPECTATOR} (a registered ghost: its life is not live). A ghost is admitted to the
 * proxy, so it is not refused, but it is never admitted to the {@code geldar:cmd} channel. Paper forces
 * the spectator game mode; Velocity cannot.
 */
public final class LoginGate {
    /** The one message every denied connection sees. */
    public static final String DENY_MESSAGE = "This connection is not admitted.";

    /**
     * The result of checking one login. {@link #HUMAN} is a human admitted by the human lane: it reaches the proxy but
     * is in neither set, so it never opens {@code geldar:cmd} and is never a ghost.
     */
    public enum Admission { DENIED, LIVE, SPECTATOR, HUMAN }

    private final LifeRegistry registry;
    private final IdentityLane lane;
    private final Set<UUID> admitted = ConcurrentHashMap.newKeySet();
    private final Set<UUID> spectators = ConcurrentHashMap.newKeySet();
    /** The concurrent-human cap. Only the human lane reserves from it; agents never do. */
    private final HumanSlots humanSlots = new HumanSlots();

    /**
     * What {@link #reserve} did with a login. {@link #NEW_SLOT} is the only result that owes the caller a release if the
     * login is refused after the reservation. {@link #FULL} is a human refused by the cap, which the caller logs apart.
     */
    public enum Reservation { DENIED, ADMITTED, NEW_SLOT, FULL }

    public LoginGate(LifeRegistry registry) {
        this(registry, IdentityLane.AGENT);
    }

    public LoginGate(LifeRegistry registry, IdentityLane lane) {
        this.registry = registry;
        this.lane = lane;
    }

    /**
     * Decides one login under the gate's lane. The agent lane is {@link #classify}; the human lane also needs the
     * connection's UUID. Pure cache lookup, safe on the event loop.
     */
    public Admission decide(UUID connection, String username) {
        return lane == IdentityLane.HUMAN ? classifyHuman(connection, username) : classify(username);
    }

    /**
     * The human lane. Refused: a name that is not a plain username, the agent prefix, a name in the registry, and the
     * offline-mode UUID of the name. Every login is refused unless the registry has synced (fail closed): with no NATS
     * URL the registry never syncs, a registry error marks it unsynced, and a sync lost later refuses again.
     */
    private Admission classifyHuman(UUID connection, String username) {
        if (!LifeRegistry.isValidUsername(username) || HumanRules.isAgentShaped(username)) {
            return Admission.DENIED;
        }
        if (HumanRules.offlineUuid(username).equals(connection)) {
            return Admission.DENIED;
        }
        if (!registry.isSynced()) {
            return Admission.DENIED;
        }
        return registry.find(username).isPresent() ? Admission.DENIED : Admission.HUMAN;
    }

    /** Classifies a username under the agent lane. Pure cache lookup, safe on the event loop; the human lane denies. */
    public Admission classify(String username) {
        if (lane == IdentityLane.HUMAN || !LifeRegistry.isValidUsername(username) || !registry.isSynced()) {
            return Admission.DENIED;
        }
        Optional<LifeRegistry.Entry> life = registry.find(username);
        if (life.isEmpty()) {
            return Admission.DENIED;
        }
        return life.get().live() ? Admission.LIVE : Admission.SPECTATOR;
    }

    /** True when this username may log in, as a live player or as a spectator. */
    public boolean admits(String username) {
        return classify(username) != Admission.DENIED;
    }

    /** Checks the login and, when it passes, remembers the connection as admitted. */
    public boolean admit(UUID connection, String username) {
        Reservation reservation = reserve(connection, username);
        return reservation == Reservation.ADMITTED || reservation == Reservation.NEW_SLOT;
    }

    /** {@link #reserve(Object, UUID, String)} with the UUID as the owner: for a caller that has no connection object. */
    public Reservation reserve(UUID connection, String username) {
        return reserve(connection, connection, username);
    }

    /**
     * Checks the login and records it. A live or ghost connection is remembered. A human takes one of the
     * {@link HumanSlots#CAP} slots for its {@code owner}, the connection object that will give it back. A UUID that
     * already holds a slot is refused, and a refused human gets the same denial as any other (no reason is returned).
     */
    public Reservation reserve(Object owner, UUID connection, String username) {
        Admission admission = decide(connection, username);
        switch (admission) {
            case LIVE -> admitted.add(connection);
            case SPECTATOR -> spectators.add(connection);
            case HUMAN -> {
                return switch (humanSlots.reserve(owner, connection)) {
                    case FULL -> Reservation.FULL;
                    case TAKEN -> Reservation.DENIED;
                    case NEW -> Reservation.NEW_SLOT;
                };
            }
            case DENIED -> {
                return Reservation.DENIED;
            }
        }
        return Reservation.ADMITTED;
    }

    /** Gives back the human slot that this owner reserved. Only that owner's slot is freed; any other owner is a no-op. */
    public void releaseSlot(Object owner) {
        humanSlots.release(owner);
    }

    /** Forgets a live or ghost connection that disconnected. Safe to repeat. Human slots are given back by {@link #releaseSlot}. */
    public void release(UUID connection) {
        admitted.remove(connection);
        spectators.remove(connection);
    }

    /** True for a live connection that passed {@link #admit}; the {@code geldar:cmd} channel is open only to these. */
    public boolean isAdmitted(UUID connection) {
        return admitted.contains(connection);
    }

    /** True for a ghost connection that passed {@link #admit} as a spectator. */
    public boolean isSpectator(UUID connection) {
        return spectators.contains(connection);
    }
}
