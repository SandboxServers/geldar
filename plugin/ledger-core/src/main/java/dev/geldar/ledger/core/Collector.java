package dev.geldar.ledger.core;

/** Loader-neutral collector lifecycle. */
public interface Collector {
    /** The collector id used in config keys and the {@code collector} attribute. */
    String id();

    /** Must not throw out; the shell catches and disables the collector. */
    void start(CollectorContext ctx);

    /** Idempotent; unregisters everything this collector registered. */
    void stop();
}
