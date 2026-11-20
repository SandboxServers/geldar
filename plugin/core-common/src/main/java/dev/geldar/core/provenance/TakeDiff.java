package dev.geldar.core.provenance;

import java.util.Map;
import java.util.TreeMap;

/** What a player took from one container between two snapshots of its item counts. Bukkit-free. */
public final class TakeDiff {
    private TakeDiff() {}

    /**
     * The items whose count went down from {@code before} to {@code after}, with the amount of the decrease. A removed
     * item counts as down to zero. An increase (a deposit) and an unchanged count are not takes. Keys are sorted.
     */
    public static Map<String, Integer> taken(Map<String, Integer> before, Map<String, Integer> after) {
        Map<String, Integer> taken = new TreeMap<>();
        for (Map.Entry<String, Integer> e : before.entrySet()) {
            int was = e.getValue();
            int now = after.getOrDefault(e.getKey(), 0);
            if (was > now) {
                taken.put(e.getKey(), was - now);
            }
        }
        return taken;
    }
}
