package dev.geldar.core.proximity;

import java.util.Objects;
import org.bukkit.Location;

/** Applies {@link ProximityRule} to two Bukkit locations: the Bukkit side of the hearing rule. */
final class Hearing {
    private Hearing() {
    }

    /** True when {@code listener} hears a line spoken at {@code source}. */
    static boolean between(Location source, Location listener) {
        boolean sameWorld = Objects.equals(source.getWorld(), listener.getWorld());
        return ProximityRule.heard(
                sameWorld,
                listener.getX() - source.getX(),
                listener.getY() - source.getY(),
                listener.getZ() - source.getZ());
    }
}
