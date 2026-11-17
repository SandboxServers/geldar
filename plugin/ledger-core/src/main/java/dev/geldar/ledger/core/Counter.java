package dev.geldar.ledger.core;

/** A registered counter. Bind once at startup, never per event. */
public interface Counter {
    /** Binds attribute values (same order as the registered keys). Startup only. */
    BoundCounter bind(String... attrValues);
}
