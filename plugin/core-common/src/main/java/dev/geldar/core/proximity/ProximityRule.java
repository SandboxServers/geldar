package dev.geldar.core.proximity;

/**
 * The hearing rule for speech and death messages (spec 5.8, decisions 0198 and 0199). The raw gate is plain 3D
 * distance: a listener beyond {@link #HEARING_RADIUS_BLOCKS} learns nothing. Death messages stay on that gate alone.
 * Chat words use the tier of the effective distance ({@link #tier}). Pure: no Bukkit types.
 */
public final class ProximityRule {
    /** The hearing radius in blocks: the raw gate and the clear limit. A listener exactly this far still hears. */
    public static final double HEARING_RADIUS_BLOCKS = 32.0;

    private static final double RADIUS_SQUARED = HEARING_RADIUS_BLOCKS * HEARING_RADIUS_BLOCKS;

    private ProximityRule() {
    }

    /**
     * True when a listener at the offset (dx, dy, dz) from the source is inside the raw 3D gate, in blocks. A listener
     * in another world never hears. A NaN offset is not heard.
     */
    public static boolean heard(boolean sameWorld, double dx, double dy, double dz) {
        if (!sameWorld) {
            return false;
        }
        return dx * dx + dy * dy + dz * dz <= RADIUS_SQUARED;
    }

    /**
     * The hearing tier of an effective distance (decision 0199, step 2). A cut-short ray is silent. Clear is at most
     * {@link #HEARING_RADIUS_BLOCKS}; muffled runs to that plus {@code margin} inclusive; anything more, or NaN, is
     * silent.
     */
    public static Tier tier(double effective, boolean cutShort, double margin) {
        if (cutShort) {
            return Tier.SILENT;
        }
        if (effective <= HEARING_RADIUS_BLOCKS) {
            return Tier.CLEAR;
        }
        if (effective <= HEARING_RADIUS_BLOCKS + margin) {
            return Tier.MUFFLED;
        }
        return Tier.SILENT;
    }
}
