package dev.geldar.ledger.core;

/** A registered histogram. Bind once at startup, never per event. */
public interface Histogram {
    /** Binds attribute values (same order as the registered keys). Startup only. */
    BoundHistogram bind(String... attrValues);
}
