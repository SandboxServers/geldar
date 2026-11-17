package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import io.nats.client.Options;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

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

    @Test
    @Timeout(30)
    void theSendLoopThrowsAfterTheMaxFailuresInARowSoTheWorkerReconnects() {
        NatsEventPublisher publisher = idle();
        try {
            publisher.publish(event());
            int[] calls = {0};
            NatsEventPublisher.Sender counting = (subject, headers, body) -> {
                calls[0]++;
                throw new IOException("stream gone");
            };
            IOException error = org.junit.jupiter.api.Assertions.assertThrows(
                    IOException.class, () -> publisher.sendWhileConnected(() -> true, counting, 0));
            assertEquals(NatsEventPublisher.MAX_CONSECUTIVE_FAILURES, calls[0]);
            assertTrue(error.getMessage().contains("in a row"));
            assertEquals(1, publisher.queued(), "the failed event is still queued");
        } finally {
            publisher.close();
        }
    }

    private static Function<String, String> settings(Map<String, String> values) {
        return values::get;
    }

    @Test
    void connectsUnauthenticatedWhenNoCredentialIsSet() {
        Options options = NatsEventPublisher.withCredentials(Options.builder().server("nats://127.0.0.1:4222"), settings(Map.of())).build();
        assertNull(options.getUsername());
        assertNull(options.getPassword());
    }

    @Test
    void readsTheUserAndTheTrimmedPasswordFileWhenSet(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("paper.txt"), "pw-from-file\n");
        Map<String, String> values = Map.of("GELDAR_NATS_USER", "paper", "GELDAR_NATS_PASSWORD_FILE", file.toString());
        Options options = NatsEventPublisher.withCredentials(Options.builder().server("nats://127.0.0.1:4222"), settings(values)).build();
        assertEquals("paper", options.getUsername());
        assertEquals("pw-from-file", options.getPassword());
    }

    @Test
    void failsWithANamedSettingWhenOnlyOneOfTheTwoIsSet() {
        Map<String, String> userOnly = Map.of("GELDAR_NATS_USER", "paper");
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> NatsEventPublisher.withCredentials(Options.builder(), settings(userOnly)));
        assertTrue(error.getMessage().contains("GELDAR_NATS_PASSWORD_FILE"));
    }

    @Test
    void failsOnAMissingPasswordFileWithoutEchoingAnything(@TempDir Path dir) {
        Path missing = dir.resolve("missing.txt");
        Map<String, String> values = Map.of("GELDAR_NATS_USER", "paper", "GELDAR_NATS_PASSWORD_FILE", missing.toString());
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> NatsEventPublisher.withCredentials(Options.builder(), settings(values)));
        assertTrue(error.getMessage().contains("GELDAR_NATS_PASSWORD_FILE"));
        assertFalse(error.getMessage().contains("pw-"));
    }

    @Test
    void failsOnAnEmptyPasswordFile(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("empty.txt"), "  \n");
        Map<String, String> values = Map.of("GELDAR_NATS_USER", "paper", "GELDAR_NATS_PASSWORD_FILE", file.toString());
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> NatsEventPublisher.withCredentials(Options.builder(), settings(values)));
        assertTrue(error.getMessage().contains("is empty"));
    }
}
