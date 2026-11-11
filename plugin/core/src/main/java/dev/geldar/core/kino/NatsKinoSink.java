package dev.geldar.core.kino;

import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.function.Function;
import java.util.logging.Logger;

/**
 * Publishes feed messages on core NATS at {@code geldar.<shard>.kino.<agent_id>.feed}. Core publish only
 * buffers; a message with no connection is dropped, never queued. The connection is made on a daemon thread.
 */
public final class NatsKinoSink implements KinoSink, AutoCloseable {
    private final String shard;
    private volatile Connection connection;
    private volatile boolean closed;

    public NatsKinoSink(String url, String shard, Function<String, String> setting, Logger log) {
        this.shard = shard;
        Thread t = new Thread(() -> connect(url, setting, log), "geldar-kino-connect");
        t.setDaemon(true);
        t.start();
    }

    static String subject(String shard, String agentId) {
        return "geldar." + shard + ".kino." + agentId + ".feed";
    }

    private void connect(String url, Function<String, String> setting, Logger log) {
        try {
            Options.Builder b = Options.builder().server(url).connectionTimeout(Duration.ofSeconds(5))
                    .maxReconnects(-1);
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
            log.warning("Kino feed cannot reach NATS: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public void publish(String agentId, String json) {
        Connection nc = connection;
        if (nc != null) {
            nc.publish(subject(shard, agentId), json.getBytes(StandardCharsets.UTF_8));
        }
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