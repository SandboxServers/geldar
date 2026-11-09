package dev.geldar.core;

/** Where exported events go. Implementations must never block or throw into the server thread. */
public interface EventPublisher extends AutoCloseable {
    /** Hands one event over for delivery; returns at once. */
    void publish(EventEnvelope event);

    /** Stops delivery and releases connections. */
    @Override
    void close();
}