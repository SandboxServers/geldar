package dev.geldar.core;

import java.util.function.Function;
import java.util.regex.Pattern;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Settings from {@code plugins/GeldarCore/config.yml}. The environment wins over the file:
 * {@code GELDAR_NATS_URL} and {@code GELDAR_SHARD}. Phase 0 has one open NATS, so there is no credential.
 */
public record CoreConfig(String natsUrl, String shard, int queueCapacity, int tpsIntervalSeconds) {

    public static final String DEFAULT_NATS_URL = "nats://nats:4222";
    public static final String DEFAULT_SHARD = "phase0";

    /** A shard name is one NATS subject token: lowercase, digits and dashes, starting with a letter. */
    private static final Pattern SHARD_NAME = Pattern.compile("^[a-z][a-z0-9-]{1,31}$");

    /**
     * Reads the config section, letting the environment override the URL and the shard.
     *
     * @throws IllegalArgumentException when the shard name is not a valid subject token
     */
    public static CoreConfig load(ConfigurationSection file, Function<String, String> env) {
        String url = firstNonBlank(env.apply("GELDAR_NATS_URL"), file.getString("nats.url"), DEFAULT_NATS_URL);
        String shard = firstNonBlank(env.apply("GELDAR_SHARD"), file.getString("shard"), DEFAULT_SHARD);
        if (!SHARD_NAME.matcher(shard).matches()) {
            throw new IllegalArgumentException("shard \"" + shard + "\" must match " + SHARD_NAME.pattern());
        }
        int capacity = Math.max(1, file.getInt("queue.capacity", 10_000));
        int tps = Math.max(1, file.getInt("tps_interval_seconds", 20));
        return new CoreConfig(url, shard, capacity, tps);
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        throw new IllegalStateException("no value");
    }
}