package dev.geldar.core.proximity;

/**
 * The tunable muffle values of decision 0199 (spec 5.9 {@code chat.muffle}): the margin, the sealed-room penalty and
 * the two read caps. The defaults are the {@link MuffleConfig} proposals, not measured; MH-8a sets the final values.
 */
public record MuffleSettings(double margin, double sealedPenalty, int perLineCap, int perRayCap) {
    /** The proposal values from {@link MuffleConfig}. */
    public static MuffleSettings defaults() {
        return new MuffleSettings(
                MuffleConfig.MARGIN,
                MuffleConfig.SEALED_PENALTY,
                MuffleConfig.PER_LINE_READ_CAP,
                MuffleConfig.PER_RAY_READ_CAP);
    }

    /** Checks each value: a margin and a penalty are finite and not negative, the caps are at least 1. */
    public MuffleSettings {
        if (!Double.isFinite(margin) || margin < 0) {
            throw new IllegalArgumentException("chat.muffle.margin must be a finite number of 0 or more: " + margin);
        }
        if (!Double.isFinite(sealedPenalty) || sealedPenalty < 0) {
            throw new IllegalArgumentException("chat.muffle.sealed_penalty must be 0 or more: " + sealedPenalty);
        }
        if (perLineCap < 1 || perRayCap < 1) {
            throw new IllegalArgumentException("chat.muffle read caps must be at least 1");
        }
    }
}
