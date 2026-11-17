package dev.geldar.ledger.core;

import java.util.logging.Logger;

/**
 * Per-collector budget guard (PT-03e). One call in {@value #SAMPLE_EVERY} is timed. A single timed call over the
 * per-call budget, or a running average over the average budget, switches the collector off until {@link #reenable()}.
 *
 * <p>{@link #begin()} and {@link #end(long)} are called from the main thread only (the call counter is a plain
 * field); they never sleep, lock or allocate. Budgets, the switch and the flags are volatile so the config reload
 * thread and the gauge reader see them.
 */
public final class BudgetGuard implements CollectorGuard {
    /** One call in this many is timed. */
    public static final int SAMPLE_EVERY = 1024;

    /** The per-call mean is only judged after this many timed samples (a cold first call must not trip it). */
    public static final int MIN_AVG_SAMPLES = 8;

    private final String id;
    private final Logger logger;
    private volatile long avgBudgetNs;
    private volatile long maxBudgetNs;
    private volatile boolean configEnabled = true;
    private volatile boolean tripped;
    /** Set by {@link #reenable} on the config thread; consumed by the next {@link #begin} on the main thread. */
    private volatile boolean resetPending;
    private volatile boolean usesTickAverage;

    // Main thread only.
    private int calls;
    private long sumNs;
    private long samples;

    public BudgetGuard(String id, Logger logger, int budgetAvgUs, int budgetMaxUs) {
        this.id = id;
        this.logger = logger;
        setBudgets(budgetAvgUs, budgetMaxUs);
    }

    public String id() {
        return id;
    }

    /** Updates the budgets (config reload). Does not re-enable. */
    public void setBudgets(int budgetAvgUs, int budgetMaxUs) {
        this.avgBudgetNs = budgetAvgUs * 1000L;
        this.maxBudgetNs = budgetMaxUs * 1000L;
    }

    /** The config switch (master and collector enabled). A guard whose config is off is not allowed. */
    void setConfigEnabled(boolean enabled) {
        this.configEnabled = enabled;
    }

    boolean configEnabled() {
        return configEnabled;
    }

    @Override
    public boolean allowed() {
        return configEnabled && !tripped;
    }

    /** True once this collector switched itself off: the value of the disabled gauge (0/1). */
    public boolean disabled() {
        return tripped;
    }

    @Override
    public long begin() {
        if (resetPending) {
            resetPending = false;
            sumNs = 0;
            samples = 0;
        }
        if (++calls < SAMPLE_EVERY) {
            return 0L;
        }
        calls = 0;
        long t = System.nanoTime();
        return t == 0L ? 1L : t;
    }

    @Override
    public void end(long token) {
        if (token == 0L) {
            return;
        }
        long elapsed = System.nanoTime() - token;
        if (elapsed > maxBudgetNs) {
            disable("one call took " + elapsed / 1000 + " us, over the " + maxBudgetNs / 1000 + " us limit");
            return;
        }
        sumNs += elapsed;
        samples++;
        if (!usesTickAverage && samples >= MIN_AVG_SAMPLES && sumNs / samples > avgBudgetNs) {
            disable("average call " + sumNs / samples / 1000 + " us, over the " + avgBudgetNs / 1000 + " us budget");
        }
    }

    /**
     * For a collector that samples per tick: its measured per-tick average in microseconds. From the first call on
     * this replaces the per-call mean. Over the average budget switches the collector off.
     */
    public void tickAverageUs(double averageUs) {
        usesTickAverage = true;
        if (averageUs * 1000.0 > avgBudgetNs) {
            disable("tick average " + (long) averageUs + " us, over the " + avgBudgetNs / 1000 + " us budget");
        }
    }

    /** Switches the collector off. Logs one line per switch-off; a second call while off does nothing. */
    public void disable(String reason) {
        if (tripped) {
            return;
        }
        tripped = true;
        try {
            logger.warning("Collector " + id + " switched itself off: " + reason);
        } catch (Throwable ignored) {
            // S8: a logging failure never stops the server.
        }
    }

    /**
     * Only from the config reload or a plugin restart. Clears the switch at once and asks the main thread to clear the
     * running average at its next {@link #begin}; this thread never writes the main-thread-only counters.
     */
    public void reenable() {
        resetPending = true;
        tripped = false;
    }
}
