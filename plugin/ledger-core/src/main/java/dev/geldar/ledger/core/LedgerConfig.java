package dev.geldar.ledger.core;

import java.util.Map;

/**
 * Immutable config snapshot, parsed from a {@code .properties} file by {@link ConfigParser}. Every key has a default
 * in code; a missing file means defaults.
 *
 * <p>Keys:
 *
 * <ul>
 *   <li>{@code enabled=true}: master switch. False turns every collector off.
 *   <li>{@code collector.<id>.enabled=true}
 *   <li>{@code collector.<id>.budget_avg_us} (default 50) and {@code collector.<id>.budget_max_us} (default 250)
 *   <li>{@code collector.census.duty.<EventClass>=<on_ticks>/<period_ticks>}
 *   <li>{@code rate.<eventName>=<per second>} (default 20)
 *   <li>{@code queue.<name>.capacity} (default 4096, min 64, max 65536)
 *   <li>{@code content.max_bytes=32768} (hard max 32768)
 *   <li>{@code stall.threshold_ms=2000}
 *   <li>{@code sample.world_every_ticks=200}, {@code sample.player_every_ticks=20}
 *   <li>{@code jfr.enabled=true}
 *   <li>{@code container.cgroup_root=/sys/fs/cgroup} (PT-09c; same path rule as below)
 *   <li>{@code disk.area.<name>.path} for name in world, plugin_data, logs, bluemap, chunky (PT-10a; unset = none).
 *       A path containing {@code secret} (any case), a {@code ..} segment or a control character rejects the file
 * </ul>
 *
 * Unknown keys are errors. A key ending in {@code password}, {@code secret}, {@code token}, {@code key} or
 * {@code authorization} (any case) rejects the whole file (S4).
 */
public record LedgerConfig(
        boolean enabled,
        Map<String, Boolean> collectorEnabled,
        Map<String, Integer> budgetAvgUs,
        Map<String, Integer> budgetMaxUs,
        Map<String, Duty> duty,
        Map<String, Integer> rates,
        Map<String, Integer> queueCapacity,
        int contentMaxBytes,
        long stallThresholdMs,
        int sampleWorldEveryTicks,
        int samplePlayerEveryTicks,
        boolean jfrEnabled,
        String cgroupRoot,
        Map<String, String> diskAreaPaths) {

    public static final String DEFAULT_CGROUP_ROOT = "/sys/fs/cgroup";
    /** The fixed disk area names (README section 4, {@code geldar_disk_bytes{area}}). */
    public static final java.util.List<String> DISK_AREAS = java.util.List.of("world", "plugin_data", "logs", "bluemap", "chunky");
    public static final int DEFAULT_BUDGET_AVG_US = 50;
    public static final int DEFAULT_BUDGET_MAX_US = 250;
    public static final int DEFAULT_RATE_PER_SECOND = 20;
    public static final int DEFAULT_QUEUE_CAPACITY = 4096;
    public static final int MIN_QUEUE_CAPACITY = 64;
    public static final int MAX_QUEUE_CAPACITY = 65536;
    public static final int MAX_CONTENT_BYTES = 32768;

    /** A census duty cycle: on for {@code onTicks} of every {@code periodTicks}. */
    public record Duty(int onTicks, int periodTicks) {}

    public LedgerConfig {
        collectorEnabled = Map.copyOf(collectorEnabled);
        budgetAvgUs = Map.copyOf(budgetAvgUs);
        budgetMaxUs = Map.copyOf(budgetMaxUs);
        duty = Map.copyOf(duty);
        rates = Map.copyOf(rates);
        queueCapacity = Map.copyOf(queueCapacity);
        diskAreaPaths = Map.copyOf(diskAreaPaths);
    }

    /** The original 12-component shape (kept for existing callers): default cgroup root, no disk areas. */
    public LedgerConfig(
            boolean enabled,
            Map<String, Boolean> collectorEnabled,
            Map<String, Integer> budgetAvgUs,
            Map<String, Integer> budgetMaxUs,
            Map<String, Duty> duty,
            Map<String, Integer> rates,
            Map<String, Integer> queueCapacity,
            int contentMaxBytes,
            long stallThresholdMs,
            int sampleWorldEveryTicks,
            int samplePlayerEveryTicks,
            boolean jfrEnabled) {
        this(enabled, collectorEnabled, budgetAvgUs, budgetMaxUs, duty, rates, queueCapacity, contentMaxBytes,
                stallThresholdMs, sampleWorldEveryTicks, samplePlayerEveryTicks, jfrEnabled, DEFAULT_CGROUP_ROOT, Map.of());
    }

    /** All defaults (the file default {@code enabled=true}; {@link ConfigWatcher} serves {@link #disabled()} before the first load). */
    public static LedgerConfig defaults() {
        return new LedgerConfig(
                true, Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), MAX_CONTENT_BYTES, 2000, 200, 20, true);
    }

    /** The master-off state: every collector off. */
    public static LedgerConfig disabled() {
        return defaults().withEnabled(false);
    }

    /** A copy with the master switch set. */
    public LedgerConfig withEnabled(boolean on) {
        return new LedgerConfig(on, collectorEnabled, budgetAvgUs, budgetMaxUs, duty, rates, queueCapacity,
                contentMaxBytes, stallThresholdMs, sampleWorldEveryTicks, samplePlayerEveryTicks, jfrEnabled,
                cgroupRoot, diskAreaPaths);
    }

    /** The configured path of a disk area, or null when none is configured (the collector skips it). */
    public String diskAreaPath(String area) {
        return area == null ? null : diskAreaPaths.get(area);
    }

    /** True when the master switch is on and the collector is not switched off. */
    public boolean collectorEnabled(String id) {
        return enabled && id != null && collectorEnabled.getOrDefault(id, Boolean.TRUE);
    }

    public int budgetAvgUs(String id) {
        return budgetAvgUs.getOrDefault(id, DEFAULT_BUDGET_AVG_US);
    }

    public int budgetMaxUs(String id) {
        return budgetMaxUs.getOrDefault(id, DEFAULT_BUDGET_MAX_US);
    }

    /** The duty cycle of an event class, or null when none is configured (always on). */
    public Duty dutyFor(String eventClass) {
        return duty.get(eventClass);
    }

    public int rateFor(String eventName) {
        return rates.getOrDefault(eventName, DEFAULT_RATE_PER_SECOND);
    }

    public int queueCapacityFor(String queue) {
        return queueCapacity.getOrDefault(queue, DEFAULT_QUEUE_CAPACITY);
    }
}
