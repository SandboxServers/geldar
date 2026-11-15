package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;

/** The chat hop fails closed: every failure gives an empty set, cancels what is queued, and keeps the interrupt flag. */
class ChatHopTest {
    private static final BooleanSupplier OFF_THREAD = () -> false;
    private static final Set<String> HEARD = Set.of("ann");

    private final List<String> log = new ArrayList<>();

    private ChatHop<String> hop(BooleanSupplier onServerThread, ChatHop.Submitter<String> submitter) {
        return new ChatHop<>(onServerThread, submitter, Duration.ofMillis(50), log::add);
    }

    @Test
    void onTheServerThreadTheWorkRunsInlineAndNothingIsQueued() {
        ChatHop.Submitter<String> refuse = work -> {
            throw new AssertionError("the server thread must not queue work");
        };
        assertEquals(HEARD, hop(() -> true, refuse).call(() -> HEARD));
        assertTrue(log.isEmpty());
    }

    @Test
    void aFinishedRunReturnsItsResult() {
        assertEquals(HEARD, hop(OFF_THREAD, work -> CompletableFuture.completedFuture(HEARD)).call(() -> HEARD));
        assertTrue(log.isEmpty());
    }

    @Test
    void aTimeoutCancelsTheQueuedRunAndFailsClosed() {
        CompletableFuture<Set<String>> queued = new CompletableFuture<>();
        assertEquals(Set.of(), hop(OFF_THREAD, work -> queued).call(() -> HEARD));
        assertTrue(queued.isCancelled(), "a timed-out run is cancelled");
        assertFalse(Thread.currentThread().isInterrupted());
        assertTrue(log.get(0).contains("timed out"), log.toString());
    }

    @Test
    void anInterruptCancelsTheRunRestoresTheFlagAndFailsClosed() {
        CompletableFuture<Set<String>> queued = new CompletableFuture<>();
        Thread.currentThread().interrupt();
        try {
            assertEquals(Set.of(), hop(OFF_THREAD, work -> queued).call(() -> HEARD));
            assertTrue(queued.isCancelled(), "an interrupted run is cancelled");
            assertTrue(Thread.currentThread().isInterrupted(), "the interrupt flag is restored");
            assertTrue(log.get(0).contains("interrupted"), log.toString());
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void aRefusedSubmitFailsClosedSoAPluginThatIsDisabledDeliversNothing() {
        ChatHop.Submitter<String> disabled = work -> {
            throw new IllegalStateException("plugin disabled");
        };
        assertEquals(Set.of(), hop(OFF_THREAD, disabled).call(() -> HEARD));
        assertTrue(log.get(0).contains("failed"), log.toString());
    }

    @Test
    void aRunThatFailedFailsClosed() {
        CompletableFuture<Set<String>> failed = new CompletableFuture<>();
        failed.completeExceptionally(new IllegalStateException("judge broke"));
        assertEquals(Set.of(), hop(OFF_THREAD, work -> failed).call(() -> HEARD));
        assertTrue(log.get(0).contains("failed"), log.toString());
    }

    @Test
    void aJudgeThatThrowsOnTheServerThreadFailsClosed() {
        ChatHop.Submitter<String> unused = work -> {
            throw new AssertionError("the server thread must not queue work");
        };
        Set<String> result = hop(() -> true, unused).call(() -> {
            throw new IllegalStateException("judge broke");
        });
        assertEquals(Set.of(), result);
        assertTrue(log.get(0).contains("judge failed"), log.toString());
    }
}
