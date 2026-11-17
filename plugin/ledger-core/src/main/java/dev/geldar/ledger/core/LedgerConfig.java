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
        boolean jfrEnabled) {

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
    }

    /** All defaults. */
    public static LedgerConfig defaults() {
        return new LedgerConfig(
                true, Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), MAX_CONTENT_BYTES, 2000, 200, 20, true);
    }

    /** The master-off state: every collector off. */
    public static LedgerConfig disabled() {
        LedgerConfig d = defaults();
        return new LedgerConfig(
                false,
                d.collectorEnabled,
                d.budgetAvgUs,
                d.budgetMaxUs,
                d.duty,
                d.rates,
                d.queueCapacity,
                d.contentMaxBytes,
                d.stallThresholdMs,
                d.sampleWorldEveryTicks,
                d.samplePlayerEveryTicks,
                d.jfrEnabled);
    }

    /** True when the master switch is on and the collector is not switched off. */
    public boolean collectorEnabled(String id) {
        return enabled && collectorEnabled.getOrDefault(id, Boolean.TRUE);
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
