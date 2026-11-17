package dev.geldar.ledger.core;

/** Per-collector budget guard. All methods are safe on the main thread. */
public interface CollectorGuard {
    /** False once this collector switched itself off. */
    boolean allowed();

    /** Returns 0 unless this call is one of the 1-in-1024 timed calls. */
    long begin();

    /** Ends a call. Over budget: disables the collector, sets the gauge, logs one line. */
    void end(long token);
}
