package dev.geldar.core.speech;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * One speech bubble per agent, keyed by the agent's UUID. A new put replaces the agent's bubble and restarts its
 * clock. A bubble expires once it is {@link #LIFETIME_MILLIS} old (at exactly that age it is expired). Pure: no
 * Bukkit or BlueMap types. Every method is synchronized, since chat arrives on another thread.
 */
public final class BubbleBook {
    /**
     * How long a bubble stays on the map. BlueMap's web app re-reads markers only every few seconds, so a bubble
     * shorter than that interval may never show (see decision 0197).
     */
    public static final long LIFETIME_MILLIS = 12_000L;

    private record Bubble(String text, long shownAt) {}

    private final Map<UUID, Bubble> bubbles = new HashMap<>();

    /** Shows the text for the agent, replacing any bubble it already has. */
    public synchronized void put(UUID agent, String text, long nowMillis) {
        bubbles.put(agent, new Bubble(text, nowMillis));
    }

    /** The agents whose bubbles are {@link #LIFETIME_MILLIS} old or older. Nothing is removed. */
    public synchronized Set<UUID> expired(long nowMillis) {
        Set<UUID> out = new HashSet<>();
        for (Map.Entry<UUID, Bubble> entry : bubbles.entrySet()) {
            if (nowMillis - entry.getValue().shownAt() >= LIFETIME_MILLIS) {
                out.add(entry.getKey());
            }
        }
        return out;
    }

    public synchronized void remove(UUID agent) {
        bubbles.remove(agent);
    }

    /** A copy of the agent id to text map. */
    public synchronized Map<UUID, String> snapshot() {
        Map<UUID, String> out = new HashMap<>();
        for (Map.Entry<UUID, Bubble> entry : bubbles.entrySet()) {
            out.put(entry.getKey(), entry.getValue().text());
        }
        return out;
    }
}
