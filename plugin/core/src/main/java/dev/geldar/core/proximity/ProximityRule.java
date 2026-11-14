package dev.geldar.core.proximity;

/**
 * The hearing rule for speech and death messages (spec 5.8): a player hears a line when they share the speaker's
 * world and stand within {@link #HEARING_RADIUS_BLOCKS} in three dimensions. Pure: no Bukkit types.
 */
public final class ProximityRule {
    /** The hearing radius in blocks. A player exactly this far away still hears (the bound is inclusive). */
    public static final double HEARING_RADIUS_BLOCKS = 32.0;

    private static final double RADIUS_SQUARED = HEARING_RADIUS_BLOCKS * HEARING_RADIUS_BLOCKS;

    private ProximityRule() {
    }

    /**
     * True when a listener at the offset (dx, dy, dz) from the source hears the line, in blocks. A listener in
     * another world never hears. A NaN offset is not heard.
     */
    public static boolean heard(boolean sameWorld, double dx, double dy, double dz) {
        if (!sameWorld) {
            return false;
        }
        return dx * dx + dy * dy + dz * dz <= RADIUS_SQUARED;
    }
}
