package dev.geldar.ledger.core;

/** What the shell hands a collector at start. */
public interface CollectorContext {
    Ledger ledger();

    HostScheduler scheduler();

    HostInfo host();
}
