package dev.geldar.core.lakitu;

import java.util.function.Consumer;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Settings of the Lakitu feed (decision 0100). Read once at enable. A value above its maximum is clamped and
 * reported once through {@code warn}; a value below its minimum is raised to it. The feed is off by default
 * (invariant I8).
 */
public record LakituConfig(
        boolean enabled,
        int radiusChunks,
        int maxSectionsPerFrame,
        int maxUpdatesPerFrame,
        int maxPanesPerSession,
        int frameHz) {

    public static final int MAX_RADIUS_CHUNKS = 4;
    public static final int MAX_SECTIONS_PER_FRAME = 256;
    public static final int MAX_UPDATES_PER_FRAME = 512;
    public static final int MAX_PANES_PER_SESSION = 4;
    public static final int MAX_FRAME_HZ = 10;
    public static final int DEFAULT_FRAME_HZ = 5;

    /** Reads {@code lakitu.*} from the config; {@code warn} gets one line per clamped key. */
    public static LakituConfig load(ConfigurationSection file, Consumer<String> warn) {
        return new LakituConfig(
                file.getBoolean("lakitu.enabled", false),
                clamp(file, "lakitu.radius_chunks", MAX_RADIUS_CHUNKS, MAX_RADIUS_CHUNKS, warn),
                clamp(file, "lakitu.max_sections_per_frame", MAX_SECTIONS_PER_FRAME, MAX_SECTIONS_PER_FRAME, warn),
                clamp(file, "lakitu.max_updates_per_frame", MAX_UPDATES_PER_FRAME, MAX_UPDATES_PER_FRAME, warn),
                clamp(file, "lakitu.max_panes_per_session", MAX_PANES_PER_SESSION, MAX_PANES_PER_SESSION, warn),
                clamp(file, "lakitu.frame_hz", DEFAULT_FRAME_HZ, MAX_FRAME_HZ, warn));
    }

    private static int clamp(ConfigurationSection file, String key, int fallback, int max, Consumer<String> warn) {
        int value = file.getInt(key, fallback);
        if (value > max) {
            warn.accept(key + " = " + value + " is above the maximum; using " + max);
            return max;
        }
        if (value < 1) {
            warn.accept(key + " = " + value + " is below 1; using 1");
            return 1;
        }
        return value;
    }
}
