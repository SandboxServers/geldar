package dev.geldar.core;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Keeps published events in a list; used by tests and when NATS is not configured. */
public final class InMemoryEventPublisher implements EventPublisher {
    private final List<EventEnvelope> events = new CopyOnWriteArrayList<>();

    @Override
    public void publish(EventEnvelope event) {
        events.add(event);
    }

    /** A snapshot of everything published so far. */
    public List<EventEnvelope> events() {
        return List.copyOf(events);
    }

    @Override
    public void close() {}
}