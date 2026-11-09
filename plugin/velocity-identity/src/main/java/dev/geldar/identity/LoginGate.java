package dev.geldar.identity;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The bot-ingress decision (spec Appendix F): a username is admitted only when the registry has
 * synced at least once and holds a valid entry for it. Everything else, including "never synced",
 * is denied with the same fixed message, so a denial reveals nothing about which check failed.
 */
public final class LoginGate {
    /** The one message every denied connection sees. */
    public static final String DENY_MESSAGE = "This connection is not admitted.";

    private final LifeRegistry registry;
    private final Set<UUID> admitted = ConcurrentHashMap.newKeySet();

    public LoginGate(LifeRegistry registry) {
        this.registry = registry;
    }

    /** True when this username may log in. Pure cache lookup, safe on the event loop. */
    public boolean admits(String username) {
        return username != null && registry.isSynced() && registry.find(username).isPresent();
    }

    /** Checks the username and, when it passes, remembers the connection as admitted. */
    public boolean admit(UUID connection, String username) {
        if (!admits(username)) {
            return false;
        }
        admitted.add(connection);
        return true;
    }

    /** Forgets a connection that disconnected. */
    public void release(UUID connection) {
        admitted.remove(connection);
    }

    /** True for a connection that passed {@link #admit}; the {@code geldar:cmd} channel is open only to these. */
    public boolean isAdmitted(UUID connection) {
        return admitted.contains(connection);
    }
}
