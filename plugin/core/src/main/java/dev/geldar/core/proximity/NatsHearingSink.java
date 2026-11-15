package dev.geldar.core.proximity;

import dev.geldar.core.EventEnvelope;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;
import java.util.logging.Logger;

/**
 * Publishes heard_muffled notices on core NATS at {@code geldar.<shard>.body.<life_id>.hearing} (decision 0199, step 9).
 * It follows {@code NatsKinoSink}: the same options and credentials settings, the connection made on a daemon thread,
 * and a message with no connection dropped, never queued. The subject is the one the Body subscribes to.
 */
public final class NatsHearingSink implements HearingNoticeSink, AutoCloseable {
    private final String shard;
    private final AtomicLong dropped = new AtomicLong();
    private volatile Connection connection;
    private volatile boolean closed;

    public NatsHearingSink(String url, String shard, Function<String, String> setting, Logger log) {
        this.shard = shard;
        Thread t = new Thread(() -> connect(url, setting, log), "geldar-hearing-connect");
        t.setDaemon(true);
        t.start();
    }

    /** A sink over a connection that already exists, for tests: no connect thread and no server. */
    NatsHearingSink(String shard, Connection connection) {
        this.shard = shard;
        this.connection = connection;
    }

    /** The per-life hearing subject; the life id must be a life id (checked by the caller and again here). */
    static String subject(String shard, String lifeId) {
        return "geldar." + shard + ".body." + lifeId + ".hearing";
    }

    private void connect(String url, Function<String, String> setting, Logger log) {
        try {
            Options.Builder b = Options.builder().server(url).connectionTimeout(Duration.ofSeconds(5))
                    .maxReconnects(-1).discardMessagesWhenOutgoingQueueFull().reconnectBufferSize(256 * 1024);
            String user = setting.apply("GELDAR_NATS_USER");
            String file = setting.apply("GELDAR_NATS_PASSWORD_FILE");
            if (user != null && !user.isBlank() && file != null && !file.isBlank()) {
                b.userInfo(user, Files.readString(Path.of(file), StandardCharsets.UTF_8).trim());
            }
            Connection nc = Nats.connect(b.build());
            if (closed) {
                nc.close();
                return;
            }
            connection = nc;
        } catch (Exception e) {
            log.warning("Hearing notices cannot reach NATS: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public void muffled(String lifeId, String direction, String band) {
        if (!EventEnvelope.isLifeId(lifeId)) {
            return;
        }
        Connection nc = connection;
        if (nc == null) {
            // No connection yet: drop and count it, as a refused publish is counted. Nothing is queued or retried.
            dropped.incrementAndGet();
            return;
        }
        String json = new MuffledNotice(direction, band).json();
        try {
            nc.publish(subject(shard, lifeId), json.getBytes(StandardCharsets.UTF_8));
        } catch (IllegalStateException e) {
            // Closed or reconnect buffer full: drop the notice; the server thread never throws or waits.
            dropped.incrementAndGet();
        }
    }

    /** Notices dropped because the connection refused them. */
    public long dropped() {
        return dropped.get();
    }

    @Override
    public void close() {
        closed = true;
        Connection nc = connection;
        if (nc != null) {
            try {
                nc.close();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
