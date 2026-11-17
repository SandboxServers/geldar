package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.EventEnvelope;
import dev.geldar.core.EventPublisher;
import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ExportLifecycleTest {
    private static final String PASSWORD = "dummy-pass-7731";
    private static final String USER = "dummy-exporter";
    private final List<String> lines = new CopyOnWriteArrayList<>();
    private final List<String> calls = new CopyOnWriteArrayList<>();
    private final OperatorSink sink = new OperatorSink() {
        @Override
        public void info(String message) {
            lines.add("info: " + message);
        }

        @Override
        public void warn(String message) {
            lines.add("warn: " + message);
        }
    };

    /** A stand-in publisher: records the order of calls; {@code connected} models a NATS outage. */
    static final class FakePublisher implements EventPublisher {
        private final List<String> calls;
        final List<EventEnvelope> published = new CopyOnWriteArrayList<>();
        volatile boolean connected;
        volatile boolean closed;

        FakePublisher(List<String> calls) {
            this.calls = calls;
        }

        @Override
        public void publish(EventEnvelope event) {
            calls.add("publish");
            published.add(event);
        }

        @Override
        public boolean connected() {
            return connected;
        }

        @Override
        public void close() {
            calls.add("close");
            closed = true;
        }
    }

    private static EventEnvelope event(String id) {
        return new EventEnvelope(id, Instant.EPOCH, "nf", 0, 0, "death", null, null);
    }

    private static ExportConfig enabled(String url) {
        return new ExportConfig(true, url, "nf", null, null, 10);
    }

    private ExportLifecycle.PublisherFactory factory(FakePublisher publisher) {
        return (config, log) -> {
            calls.add("open");
            return publisher;
        };
    }

    private static int unusedPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    @Test
    void disabledStartsNothingAndSaysSo() {
        ExportLifecycle lifecycle = new ExportLifecycle(ExportConfig.disabled(), (config, log) -> {
            throw new AssertionError("the factory must not run when the export is disabled");
        }, sink);
        lifecycle.start();
        lifecycle.publish(event("ev_1"));
        lifecycle.stop();
        assertEquals(List.of("info: geldar_neoforge export disabled"), lines);
    }

    @Test
    void startPublishStopRunInOrderAndTheStartLineNamesTheShard() {
        FakePublisher publisher = new FakePublisher(calls);
        ExportLifecycle lifecycle = new ExportLifecycle(enabled("nats://127.0.0.1:1"), factory(publisher), sink);
        lifecycle.start();
        lifecycle.publish(event("ev_1"));
        lifecycle.stop();
        assertEquals(List.of("open", "publish", "close"), calls);
        assertTrue(publisher.closed);
        assertTrue(lines.contains("info: geldar_neoforge export enabled, shard nf"));
    }

    @Test
    void factoryFailureLeavesTheServerRunningWithTheExportOff() {
        ExportLifecycle lifecycle = new ExportLifecycle(enabled("nats://127.0.0.1:1"), (config, log) -> {
            throw new IllegalStateException("boom");
        }, sink);
        assertDoesNotThrow(() -> {
            lifecycle.start();
            lifecycle.publish(event("ev_1"));
            lifecycle.stop();
        });
        assertTrue(lines.stream().anyMatch(line -> line.startsWith("warn: geldar_neoforge export could not start")));
    }

    /** Off-thread proof: publish only forwards, so a caller on the server thread does not wait while NATS is down. */
    @Test
    void publishReturnsWithoutWaitingForNats() throws InterruptedException {
        FakePublisher publisher = new FakePublisher(calls);
        publisher.connected = false;
        ExportLifecycle lifecycle = new ExportLifecycle(enabled("nats://127.0.0.1:1"), factory(publisher), sink);
        lifecycle.start();
        Thread caller = new Thread(() -> lifecycle.publish(event("ev_1")), "server-thread-stand-in");
        caller.setDaemon(true);
        caller.start();
        caller.join(2_000);
        assertFalse(caller.isAlive(), "publish waited on the NATS connection");
        assertEquals(1, publisher.published.size());
    }

    /** NATS down with the real publisher: events queue, the oldest drop once full, and stop is bounded. */
    @Test
    void natsDownDropsOldestWhenFullAndStopIsBounded() throws IOException {
        int port = unusedPort();
        ExportLifecycle.PublisherFactory natsFactory = ExportLifecycle.natsPublisher();
        AtomicReference<EventPublisher> opened = new AtomicReference<>();
        ExportLifecycle.PublisherFactory capturing = (config, log) -> {
            EventPublisher publisher = natsFactory.open(config, log);
            opened.set(publisher);
            return publisher;
        };
        ExportConfig config = new ExportConfig(true, "nats://127.0.0.1:" + port, "nf", null, null, 3);
        ExportLifecycle lifecycle = new ExportLifecycle(config, capturing, sink);
        lifecycle.start();
        for (int i = 0; i < 5; i++) {
            lifecycle.publish(event("ev_" + i));
        }
        assertEquals(2, opened.get().dropped());
        assertFalse(opened.get().connected());
        assertTimeoutPreemptively(Duration.ofSeconds(8), lifecycle::stop);
        assertTrue(lines.stream().anyMatch(line -> line.equals("info: geldar_neoforge export stopped, dropped 2")));
    }

    /** The password and the user never reach the log: the start with a file, and the URL with credentials. */
    @Test
    void logsNeverCarryTheUrlCredentialsOrThePassword(@TempDir Path dir) throws IOException {
        Path passwordFile = dir.resolve("nats-password");
        Files.writeString(passwordFile, PASSWORD + "\n");
        Properties file = new Properties();
        file.setProperty("export.enabled", "true");
        file.setProperty("shard", "nf");
        file.setProperty("nats.url", "nats://" + USER + ":" + PASSWORD + "@127.0.0.1:4222");
        ExportConfig rejected = ExportConfig.resolve(file, key -> null, ExportConfig::isReadableFile, sink);
        assertFalse(rejected.enabled());

        file.setProperty("nats.url", "nats://127.0.0.1:4222");
        file.setProperty("nats.user", USER);
        file.setProperty("nats.password.file", passwordFile.toString());
        ExportConfig config = ExportConfig.resolve(file, key -> null, ExportConfig::isReadableFile, sink);
        assertTrue(config.enabled());
        FakePublisher publisher = new FakePublisher(calls);
        ExportLifecycle lifecycle = new ExportLifecycle(config, factory(publisher), sink);
        lifecycle.start();
        lifecycle.stop();

        String logged = String.join("\n", lines);
        assertTrue(logged.contains("export enabled, shard nf"));
        assertFalse(logged.contains(PASSWORD), "the password reached the log");
        assertFalse(logged.contains(USER), "the user reached the log");
        assertFalse(logged.contains(passwordFile.toString()), "the password file path reached the log");
    }

    /** The publisher the factory opens is handed a logger that writes only to this sink. */
    @Test
    void publisherLogLinesReachTheSink() {
        ExportLifecycle.PublisherFactory logging = (config, log) -> {
            Logger logger = log;
            logger.warning("NATS unavailable (IOException), retrying in 500 ms");
            return new FakePublisher(calls);
        };
        ExportLifecycle lifecycle = new ExportLifecycle(enabled("nats://127.0.0.1:1"), logging, sink);
        lifecycle.start();
        assertTrue(lines.contains("warn: NATS unavailable (IOException), retrying in 500 ms"));
    }
}
