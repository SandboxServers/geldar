package dev.geldar.core.proximity;

import java.util.function.Consumer;

/**
 * The tunable muffle values of decision 0199 (spec 5.9 {@code chat.muffle}): the margin, the sealed-room penalty and
 * the two read caps. The defaults are the {@link MuffleConfig} proposals, not measured; MH-8a sets the final values.
 * {@code benchLog} turns on the bench-only per-line {@code muffle-bench} log line (MH-8a); it is off by default and
 * must stay off in production.
 */
public record MuffleSettings(double margin, double sealedPenalty, int perLineCap, int perRayCap, boolean benchLog) {
    /** The proposal values from {@link MuffleConfig}, with the bench log off. */
    public static MuffleSettings defaults() {
        return new MuffleSettings(
                MuffleConfig.MARGIN,
                MuffleConfig.SEALED_PENALTY,
                MuffleConfig.PER_LINE_READ_CAP,
                MuffleConfig.PER_RAY_READ_CAP,
                false);
    }

    /** Settings with the bench log off. */
    public MuffleSettings(double margin, double sealedPenalty, int perLineCap, int perRayCap) {
        this(margin, sealedPenalty, perLineCap, perRayCap, false);
    }

    /**
     * Settings from config values that may be bad, with the bench log off. A NaN or infinite margin or penalty becomes
     * its default, a negative one becomes 0, and a cap below 1 becomes 1. Each change is logged once, naming the key,
     * and never throws.
     */
    public static MuffleSettings clamped(double margin, double sealedPenalty, int perLineCap, int perRayCap,
            Consumer<String> log) {
        return clamped(margin, sealedPenalty, perLineCap, perRayCap, false, log);
    }

    /**
     * Settings from config values that may be bad, as {@link #clamped(double, double, int, int, Consumer)}, with the
     * bench log flag as given. The flag is a boolean and is never changed by clamping.
     */
    public static MuffleSettings clamped(double margin, double sealedPenalty, int perLineCap, int perRayCap,
            boolean benchLog, Consumer<String> log) {
        return new MuffleSettings(
                nonNegative("chat.muffle.margin", margin, MuffleConfig.MARGIN, log),
                nonNegative("chat.muffle.sealed_penalty", sealedPenalty, MuffleConfig.SEALED_PENALTY, log),
                atLeastOne("chat.muffle.per_line_cap", perLineCap, log),
                atLeastOne("chat.muffle.per_ray_cap", perRayCap, log),
                benchLog);
    }

    private static double nonNegative(String key, double value, double fallback, Consumer<String> log) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            log.accept(key + " is not a finite number; using " + fallback);
            return fallback;
        }
        if (value < 0) {
            log.accept(key + " is below 0; using 0");
            return 0.0;
        }
        return value;
    }

    private static int atLeastOne(String key, int value, Consumer<String> log) {
        if (value < 1) {
            log.accept(key + " is below 1; using 1");
            return 1;
        }
        return value;
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
