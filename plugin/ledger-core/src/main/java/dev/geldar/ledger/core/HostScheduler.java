package dev.geldar.ledger.core;

/** The loader's scheduler port. */
public interface HostScheduler {
    /** Runs on the main (server) thread every {@code ticks} ticks. */
    Cancellable everyTicks(int ticks, Runnable r);

    /** Runs on an async thread every {@code ms} milliseconds, never the main thread. */
    Cancellable everyMillis(long ms, Runnable r);
}
