package dev.geldar.ledger.core;

import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;

/**
 * The one object a collector holds. Registration methods run at startup, never on the main thread's hot path. Only
 * {@link BoundCounter#add}, {@link BoundHistogram#record}, {@link EventLog#record}, {@link ContentLog#record} and
 * {@link CollectorGuard} may be called from the main thread.
 */
public interface Ledger {
    /** Registers a counter. Startup only. */
    Counter counter(String name, String unit, String description, String... attrKeys);

    /** Registers a histogram with explicit bucket bounds. Startup only. */
    Histogram histogram(String name, String unit, String description, double[] bounds, String... attrKeys);

    /**
     * Registers a long gauge. The reader runs on the exporter thread and must be a cheap field read. Unlike counters
     * and histograms, {@code attrKeys} here are ALTERNATING key,value pairs (key0, value0, key1, value1, ...): the
     * registration reports one series with exactly those attributes, so one name registered several times with
     * different pairs gives several series. Only the keys are checked against the metric allow-list.
     */
    void gaugeLong(String name, String unit, String description, LongSupplier reader, String... attrKeys);

    /** Registers a double gauge; {@code attrKeys} are alternating key,value pairs as for {@link #gaugeLong}. */
    void gaugeDouble(String name, String unit, String description, DoubleSupplier reader, String... attrKeys);

    /** The event log. */
    EventLog events();

    /** The content log (owner-approved full-text capture; the gateway only). */
    ContentLog content();

    /** The budget guard of one collector. */
    CollectorGuard guard(String collectorId);

    /** The current config snapshot, swapped atomically on reload. */
    LedgerConfig config();
}
