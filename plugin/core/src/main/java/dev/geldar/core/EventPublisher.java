package dev.geldar.core;

/** Where exported events go. Implementations must never block or throw into the server thread. */
public interface EventPublisher extends AutoCloseable {
    /** Hands one event over for delivery; returns at once. */
    void publish(EventEnvelope event);

    /** How many events were discarded because the queue was full; 0 when nothing is ever dropped. */
    default long dropped() {
        return 0;
    }

    /** Whether the publisher can currently deliver; true when there is no connection to lose. */
    default boolean connected() {
        return true;
    }

    /** Stops delivery and releases connections. */
    @Override
    void close();
}