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

    /** The result of checking one username against the registry. */
    public enum Admission { DENIED, LIVE, SPECTATOR }

    private final LifeRegistry registry;
    private final Set<UUID> admitted = ConcurrentHashMap.newKeySet();
    private final Set<UUID> spectators = ConcurrentHashMap.newKeySet();

    public LoginGate(LifeRegistry registry) {
        this.registry = registry;
    }

    /** Classifies a username. Pure cache lookup, safe on the event loop. */
    public Admission classify(String username) {
        if (!LifeRegistry.isValidUsername(username) || !registry.isSynced()) {
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

    /** Checks the username and, when it passes, remembers the connection as admitted. */
    public boolean admit(UUID connection, String username) {
        Admission admission = classify(username);
        switch (admission) {
            case LIVE -> admitted.add(connection);
            case SPECTATOR -> spectators.add(connection);
            case DENIED -> {
                return false;
            }
        }
        return true;
    }

    /** Forgets a connection that disconnected. */
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
