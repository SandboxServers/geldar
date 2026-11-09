package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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

    /** A publisher whose worker never connects, so the tests drive the retry paths by hand. */
    private static NatsEventPublisher idle() {
        return new NatsEventPublisher("nats://127.0.0.1:1", 10, Logger.getLogger("test"));
    }

    private static final NatsEventPublisher.Sender FAILING = (subject, headers, body) -> {
        throw new IOException("stream gone");
    };

    @Test
    void aFailedSendGoesBackToTheHeadAndCountsTowardAReconnect() {
        NatsEventPublisher publisher = idle();
        try {
            EventEnvelope first = event();
            EventEnvelope second = event();
            publisher.publish(first);
            publisher.publish(second);
            assertFalse(publisher.attempt(FAILING, first));
            assertEquals(3, publisher.queued(), "the failed event is queued again");
            assertEquals(1, publisher.failed());
            for (int i = 1; i < NatsEventPublisher.MAX_CONSECUTIVE_FAILURES; i++) {
                publisher.attempt(FAILING, event());
            }
            assertEquals(NatsEventPublisher.MAX_CONSECUTIVE_FAILURES, publisher.consecutiveFailures());
        } finally {
            publisher.close();
        }
    }

    @Test
    void aSuccessfulSendResetsTheFailureRun() {
        NatsEventPublisher publisher = idle();
        try {
            for (int i = 0; i < NatsEventPublisher.MAX_CONSECUTIVE_FAILURES - 1; i++) {
                publisher.attempt(FAILING, event());
            }
            assertTrue(publisher.attempt((subject, headers, body) -> { }, event()));
            assertEquals(1, publisher.published());
            publisher.attempt(FAILING, event());
            assertEquals(1, publisher.consecutiveFailures());
        } finally {
            publisher.close();
        }
    }

    @Test
    void flushOnCloseSendsEverythingQueuedWhileConnected() throws Exception {
        NatsEventPublisher publisher = idle();
        try {
            for (int i = 0; i < 3; i++) {
                publisher.publish(event());
            }
            List<String> subjects = new ArrayList<>();
            publisher.flush((subject, headers, body) -> subjects.add(subject), () -> true, 1_000);
            assertEquals(3, subjects.size());
            assertEquals(0, publisher.queued());
        } finally {
            publisher.close();
        }
    }

    @Test
    void flushOnCloseKeepsTheEventThatFailedAndStops() throws Exception {
        NatsEventPublisher publisher = idle();
        try {
            publisher.publish(event());
            publisher.publish(event());
            publisher.flush(FAILING, () -> true, 1_000);
            assertEquals(2, publisher.queued());
            assertEquals(1, publisher.failed(), "stops at the first failure");
        } finally {
            publisher.close();
        }
    }

    @Test
    void flushOnCloseSendsNothingWhenDisconnected() throws Exception {
        NatsEventPublisher publisher = idle();
        try {
            publisher.publish(event());
            publisher.flush((subject, headers, body) -> { throw new AssertionError("sent"); }, () -> false, 1_000);
            assertEquals(1, publisher.queued());
        } finally {
            publisher.close();
        }
    }
}