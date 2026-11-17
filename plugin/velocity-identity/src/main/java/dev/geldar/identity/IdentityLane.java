package dev.geldar.identity;

import java.util.Optional;

/**
 * Which logins the identity gate admits. {@link #AGENT} is the bot ingress: an offline-mode proxy that admits only
 * usernames in the life registry (spec Appendix F, 8.4). {@link #HUMAN} is the human-directed NeoForge shard, behind
 * an online-mode proxy: see {@link HumanRules} for what it refuses. The lane comes from {@link #ENV}.
 */
public enum IdentityLane {
    AGENT,
    HUMAN;

    /** The environment variable that selects the lane. Unset means {@link #AGENT}. */
    public static final String ENV = "GELDAR_IDENTITY_LANE";

    /**
     * Parses the raw setting. Unset ({@code null}) is {@link #AGENT}. Exactly {@code agent} and {@code human} are the
     * two lanes. Any other value, including an empty one, is empty here, and the plugin refuses to start the gate.
     */
    public static Optional<IdentityLane> parse(String raw) {
        if (raw == null) {
            return Optional.of(AGENT);
        }
        return switch (raw) {
            case "agent" -> Optional.of(AGENT);
            case "human" -> Optional.of(HUMAN);
            default -> Optional.empty();
        };
    }
}
