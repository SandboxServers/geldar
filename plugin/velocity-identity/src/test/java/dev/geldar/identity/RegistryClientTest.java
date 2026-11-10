package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.Connection;
import io.nats.client.JetStreamApiException;
import io.nats.client.Options;
import io.nats.client.api.ApiResponse;
import io.nats.client.api.KeyValueOperation;
import io.nats.client.support.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.helpers.NOPLogger;

class RegistryClientTest {
    private static final byte[] VALID = "{\"life_id\":\"life_1\",\"registered_at\":\"2026-11-09T00:00:00Z\"}".getBytes(StandardCharsets.UTF_8);

    private final LifeRegistry registry = new LifeRegistry();
    private final LoginGate gate = new LoginGate(registry);
    private final RegistryClient client = new RegistryClient("nats://127.0.0.1:4222", registry, NOPLogger.NOP_LOGGER);
    private final AtomicReference<Connection.Status> status = new AtomicReference<>(Connection.Status.CONNECTED);

    /** A bucket fake: each watch replays the next key set, then reports the end of data. */
    private final class FakeBucket implements RegistryClient.Bucket {
        final AtomicInteger watches = new AtomicInteger();
        final AtomicInteger closed = new AtomicInteger();
        final AtomicReference<Object> identity = new AtomicReference<>("stream-1");
        volatile boolean absent;
        final List<List<String>> replays = new ArrayList<>();

        @Override
        public AutoCloseable watchAll(RegistryClient.Watch watch) {
            int n = watches.getAndIncrement();
            for (String key : replays.get(Math.min(n, replays.size() - 1))) {
                watch.change(KeyValueOperation.PUT, key, VALID);
            }
            watch.endOfData();
            return closed::incrementAndGet;
        }

        @Override
        public Object identity() throws Exception {
            if (absent) {
                throw new IllegalStateException("bucket gone");
            }
            return identity.get();
        }
    }

    private CompletableFuture<Void> runLoop(FakeBucket bucket, Runnable watching) {
        return CompletableFuture.runAsync(() -> {
            try {
                client.watchWhileConnected(status::get, bucket, watching, 5, 20);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
    }

    private static void await(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError("condition not reached");
            }
            Thread.sleep(5);
        }
    }

    @Test
    void theWatchLoopBeginsAReplayAndSyncsFromTheWatch() throws Exception {
        FakeBucket bucket = new FakeBucket();
        bucket.replays.add(List.of("alice"));
        CountDownLatch watching = new CountDownLatch(1);
        CompletableFuture<Void> loop = runLoop(bucket, watching::countDown);
        // Without beginReplay the end of data would not open the gate.
        await(() -> gate.admits("alice"));
        // The gate opens inside watchAll, before the watching hook runs: wait for the hook, do not assume it.
        assertTrue(watching.await(10, TimeUnit.SECONDS), "the watching hook ran");
        status.set(Connection.Status.CLOSED);
        loop.get(10, TimeUnit.SECONDS);
        assertFalse(registry.isSynced(), "the gate closes when the watch ends");
        assertEquals(1, bucket.closed.get());
    }

    @Test
    void aRecreatedBucketIsWatchedAgainAndTheOldEntriesAreDropped() throws Exception {
        FakeBucket bucket = new FakeBucket();
        bucket.replays.add(List.of("alice"));
        bucket.replays.add(List.of("bob"));
        CompletableFuture<Void> loop = runLoop(bucket, () -> {});
        await(() -> gate.admits("alice"));
        bucket.identity.set("stream-2");
        await(() -> gate.admits("bob"));
        assertFalse(gate.admits("alice"), "a key lost with the old bucket is gone");
        assertEquals(2, bucket.watches.get());
        assertTrue(bucket.closed.get() >= 1);
        status.set(Connection.Status.CLOSED);
        loop.get(10, TimeUnit.SECONDS);
    }

    @Test
    void aDeletedBucketEndsTheLoopWithTheGateClosed() throws Exception {
        FakeBucket bucket = new FakeBucket();
        bucket.replays.add(List.of("alice"));
        CompletableFuture<Void> loop = runLoop(bucket, () -> {});
        await(() -> gate.admits("alice"));
        bucket.absent = true;
        ExecutionException error = assertThrows(ExecutionException.class, () -> loop.get(10, TimeUnit.SECONDS));
        assertTrue(error.getCause().getCause() instanceof IllegalStateException);
        assertFalse(gate.admits("alice"));
        assertEquals(1, bucket.closed.get());
    }

    @Test
    void theBackoffIsNotResetWhenTheWatchCannotStart() {
        RegistryClient.Bucket failing = new RegistryClient.Bucket() {
            @Override
            public AutoCloseable watchAll(RegistryClient.Watch watch) throws Exception {
                throw new java.io.IOException("no watch");
            }

            @Override
            public Object identity() {
                return "stream-1";
            }
        };
        client.backoffMs = 4_000;
        assertThrows(java.io.IOException.class, () -> client.watchWhileConnected(status::get, failing, client::resetBackoff, 5, 20));
        assertEquals(4_000, client.backoffMs);
        assertFalse(registry.isSynced());
    }

    @Test
    void theBackoffIsResetOnceTheWatchHasStarted() throws Exception {
        FakeBucket bucket = new FakeBucket();
        bucket.replays.add(List.of("alice"));
        client.backoffMs = 4_000;
        CountDownLatch reset = new CountDownLatch(1);
        CompletableFuture<Void> loop = runLoop(bucket, () -> {
            client.resetBackoff();
            reset.countDown();
        });
        await(() -> gate.admits("alice"));
        // The reset runs after watchAll returns, which is after the gate opened; the latch publishes it.
        assertTrue(reset.await(10, TimeUnit.SECONDS), "the watch started");
        assertEquals(500, client.backoffMs);
        status.set(Connection.Status.CLOSED);
        loop.get(10, TimeUnit.SECONDS);
    }

    /** A registry that reports a disconnect from inside beginReplay, as the connection thread could. */
    private static final class DisconnectingRegistry extends LifeRegistry {
        Runnable onBeginReplay = () -> {};

        @Override
        public synchronized void beginReplay() {
            onBeginReplay.run();
            super.beginReplay();
        }
    }

    @Test
    void aDisconnectDuringTheReplayStartIsNotOverwrittenSoTheWatchIsRebuilt() throws Exception {
        DisconnectingRegistry racing = new DisconnectingRegistry();
        RegistryClient racer = new RegistryClient("nats://127.0.0.1:4222", racing, NOPLogger.NOP_LOGGER);
        AtomicInteger begins = new AtomicInteger();
        // Only the first replay start is interrupted by a disconnect.
        racing.onBeginReplay = () -> {
            if (begins.getAndIncrement() == 0) {
                racer.onConnectionEvent(null, io.nats.client.ConnectionListener.Events.DISCONNECTED);
            }
        };
        FakeBucket bucket = new FakeBucket();
        bucket.replays.add(List.of("alice"));
        CompletableFuture<Void> loop = CompletableFuture.runAsync(() -> {
            try {
                racer.watchWhileConnected(status::get, bucket, () -> {}, 5, 20);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        // Without the order fix the disconnect is lost and the first watch is never rebuilt.
        await(() -> bucket.watches.get() >= 2);
        status.set(Connection.Status.CLOSED);
        loop.get(10, TimeUnit.SECONDS);
    }

    @Test
    void recognisesOnlyAMissingStreamAsAnAbsentBucket() throws Exception {
        assertTrue(RegistryClient.bucketAbsent(apiError(10059)));
        assertTrue(RegistryClient.bucketAbsent(new RuntimeException("wrapped", apiError(10059))));
        assertFalse(RegistryClient.bucketAbsent(apiError(10014)));
        assertFalse(RegistryClient.bucketAbsent(new java.io.IOException("down")));
    }

    private static JetStreamApiException apiError(int code) throws Exception {
        var json = JsonParser.parse("{\"error\":{\"code\":404,\"err_code\":" + code + ",\"description\":\"x\"}}");
        return new JetStreamApiException(new ApiResponse<Object>(json) {});
    }

    private static Function<String, String> settings(Map<String, String> values) {
        return values::get;
    }

    @Test
    void connectsUnauthenticatedWhenNoCredentialIsSet() {
        Options options = RegistryClient.withCredentials(Options.builder().server("nats://127.0.0.1:4222"), settings(Map.of())).build();
        assertNull(options.getUsername());
        assertNull(options.getPassword());
    }

    @Test
    void readsTheUserAndTheTrimmedPasswordFileWhenSet(@TempDir Path dir) throws IOException {
        Path file = Files.writeString(dir.resolve("velocity.txt"), "pw-from-file\n");
        Map<String, String> values = Map.of("GELDAR_NATS_USER", "velocity", "GELDAR_NATS_PASSWORD_FILE", file.toString());
        Options options = RegistryClient.withCredentials(Options.builder().server("nats://127.0.0.1:4222"), settings(values)).build();
        assertEquals("velocity", options.getUsername());
        assertEquals("pw-from-file", options.getPassword());
    }

    @Test
    void failsWithANamedSettingWhenOnlyOneOfTheTwoIsSet() {
        Map<String, String> passwordOnly = Map.of("GELDAR_NATS_PASSWORD_FILE", "x.txt");
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> RegistryClient.withCredentials(Options.builder(), settings(passwordOnly)));
        assertTrue(error.getMessage().contains("GELDAR_NATS_USER"));
    }

    @Test
    void failsOnAMissingPasswordFileWithoutEchoingAnything(@TempDir Path dir) {
        Path missing = dir.resolve("missing.txt");
        Map<String, String> values = Map.of("GELDAR_NATS_USER", "velocity", "GELDAR_NATS_PASSWORD_FILE", missing.toString());
        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> RegistryClient.withCredentials(Options.builder(), settings(values)));
        assertTrue(error.getMessage().contains("GELDAR_NATS_PASSWORD_FILE"));
        assertFalse(error.getMessage().contains("pw-"));
    }
}
