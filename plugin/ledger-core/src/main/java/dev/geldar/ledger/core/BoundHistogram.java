package dev.geldar.ledger.core;

/** A histogram bound to attribute values. */
public interface BoundHistogram {
    /** O(1), no allocation, any thread (the main thread included). */
    void record(double v);
}
