package dev.geldar.ledger.core;

/** A counter bound to attribute values. */
public interface BoundCounter {
    /** O(1), no allocation, any thread (the main thread included). */
    void add(long n);
}
