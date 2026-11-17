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
 * Subscribes to {@code geldar.<shard>.kino.control} and hands each message to {@link KinoControl#receive}. The
 * subscription is on the NATS dispatcher thread; it publishes nothing. Reconnects forever, so a NATS restart
 * needs no plugin restart. Connected on a daemon thread, like {@link NatsKinoSink}.
 */
public final class NatsKinoControl implements AutoCloseable {
    private volatile Connection connection;
    private volatile boolean closed;

    public NatsKinoControl(String url, String shard, Function<String, String> setting, Logger log, KinoControl control) {
        Thread t = new Thread(() -> connect(url, shard, setting, log, control), "geldar-kino-control");
        t.setDaemon(true);
        t.start();
    }

    static String subject(String shard) {
        return "geldar." + shard + ".kino.control";
    }

    private void connect(String url, String shard, Function<String, String> setting, Logger log, KinoControl control) {
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
            nc.createDispatcher(m -> control.receive(new String(m.getData(), StandardCharsets.UTF_8)))
                    .subscribe(subject(shard));
            connection = nc;
        } catch (Exception e) {
            log.warning("Kino control cannot reach NATS: " + e.getClass().getSimpleName());
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
