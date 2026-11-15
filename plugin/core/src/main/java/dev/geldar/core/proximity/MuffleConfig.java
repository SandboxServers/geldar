package dev.geldar.core.proximity;

/**
 * The muffled-hearing constants (decision 0199). Every value is a proposal, not measured; MH-8a sets the final value.
 */
public final class MuffleConfig {
    /** Proposal, not measured; MH-8a sets the final value. Effective distance up to this is the clear tier. */
    public static final double CLEAR_LIMIT = 32.0;

    /** Proposal, not measured; MH-8a sets the final value. The muffled tier runs from CLEAR_LIMIT to CLEAR_LIMIT + this. */
    public static final double MARGIN = 8.0;

    /** Proposal, not measured; MH-8a sets the final value. Added when a listener is inside a sealed space. */
    public static final double SEALED_PENALTY = 4.0;

    /** Proposal, not measured; MH-8a sets the final value. Block reads allowed for one ray. */
    public static final int PER_RAY_READ_CAP = 64;

    /** Proposal, not measured; MH-8a sets the final value. Block reads allowed for one chat line, all listeners. */
    public static final int PER_LINE_READ_CAP = 512;

    /**
     * Proposal, not measured; MH-8a sets the final value. A standing player's eye sits this far above the feet, in
     * blocks; rays run from eye to eye.
     */
    public static final double EYE_HEIGHT = 1.62;

    /** Proposal, not measured; MH-8a sets the final value. The first y above the world's top cell (build limit). */
    public static final int DEFAULT_BUILD_LIMIT = 320;

    private MuffleConfig() {
    }
}
