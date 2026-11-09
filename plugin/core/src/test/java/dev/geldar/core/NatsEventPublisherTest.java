package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.google.gson.JsonObject;
import java.time.Duration;
import java.time.Instant;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class NatsEventPublisherTest {
    private static EventEnvelope event() {
        return EventEnvelope.create(Instant.parse("2026-11-09T00:00:00Z"), "phase0", 10, "sleep", null, new JsonObject());
    }

    @Test
    void msgIdHeaderIsTheSourceEventId() {
        EventEnvelope e = event();
        assertEquals(e.sourceEventId(), NatsEventPublisher.headers(e).getFirst("Nats-Msg-Id"));
    }

    @Test
    void publishReturnsAtOnceAndStaysDisconnectedWhenNatsIsUnreachable() {
        NatsEventPublisher publisher = new NatsEventPublisher("nats://127.0.0.1:1", 2, Logger.getLogger("test"));
        try {
            assertTimeoutPreemptively(Duration.ofMillis(500), () -> {
                for (int i = 0; i < 5; i++) {
                    publisher.publish(event());
                }
            });
            assertFalse(publisher.connected());
            assertEquals(3, publisher.dropped());
        } finally {
            assertTimeoutPreemptively(Duration.ofSeconds(5), publisher::close);
        }
    }
}