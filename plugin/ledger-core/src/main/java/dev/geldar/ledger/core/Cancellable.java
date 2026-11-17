package dev.geldar.ledger.core;

/** A scheduled task handle. */
public interface Cancellable {
    void cancel();
}
