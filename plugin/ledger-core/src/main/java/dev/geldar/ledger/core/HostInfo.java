package dev.geldar.ledger.core;

/** Facts about the host loader. */
public interface HostInfo {
    long serverTick();

    boolean isMainThread();

    String loaderName();
}
