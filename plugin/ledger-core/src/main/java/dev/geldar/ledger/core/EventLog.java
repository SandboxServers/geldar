package dev.geldar.ledger.core;

import java.util.Map;

/** Structured events. Output goes to OpenTelemetry logs only. */
public interface EventLog {
    /**
     * Registers an event. Startup only. Fields are up to 3 longs, then up to 3 strings, in this order.
     *
     * @return the id to pass to {@link #record}
     */
    int register(String eventName, Severity s, int ratePerSecond, String... fieldNames);

    /**
     * Hot path, any thread including the main thread: copies into a preallocated ring slot, allocates nothing, drops
     * when the ring is full or the event's token bucket is empty.
     */
    void record(int id, long a, long b, long c, String s1, String s2, String s3);

    /**
     * Rare events and snapshots only. Must not be called on the main thread (the implementation asserts it and logs
     * once). Goes through the same bounded queue.
     */
    void emitMap(String eventName, Severity s, Map<String, Object> attrs);
}
