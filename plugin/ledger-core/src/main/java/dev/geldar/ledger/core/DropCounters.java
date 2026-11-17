package dev.geldar.ledger.core;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Per-queue drop counts, keyed by the value of the {@code geldar.queue} attribute. Rings resolve their
 * adder once at construction, so the hot path does one {@code LongAdder.increment()} and no lookup.
 */
public final class DropCounters {
  private final Map<String, LongAdder> byQueue = new ConcurrentHashMap<>();

  /** The adder for a queue, created on first use. Call at startup, not per event. */
  public LongAdder counter(String queue) {
    return byQueue.computeIfAbsent(queue, k -> new LongAdder());
  }

  public long dropped(String queue) {
    LongAdder a = byQueue.get(queue);
    return a == null ? 0L : a.sum();
  }

  /** Snapshot of all counts, for the exporter thread. */
  public Map<String, Long> snapshot() {
    Map<String, Long> out = new java.util.TreeMap<>();
    byQueue.forEach((k, v) -> out.put(k, v.sum()));
    return out;
  }
}