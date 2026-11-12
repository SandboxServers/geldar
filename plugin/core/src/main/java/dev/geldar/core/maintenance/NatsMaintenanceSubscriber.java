package dev.geldar.core.maintenance;

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
 * Subscribes to {@code geldar.<shard>.maintenance} and hands each message to {@link MaintenanceNotices#receive}. The
 * subscription is on the NATS dispatcher thread; it publishes nothing. Reconnects forever, so a NATS restart needs no
 * plugin restart. Connected on a daemon thread, like {@link dev.geldar.core.kino.NatsKinoControl}. The NATS user is
 * the one the plugin already connects as (GELDAR_NATS_USER and GELDAR_NATS_PASSWORD_FILE).
 */
public final class NatsMaintenanceSubscriber implements AutoCloseable {
    private volatile Connection connection;
    private volatile boolean closed;

    public NatsMaintenanceSubscriber(
            String url, String shard, Function<String, String> setting, Logger log, MaintenanceNotices notices) {
        Thread t = new Thread(() -> connect(url, shard, setting, log, notices), "geldar-maintenance");
        t.setDaemon(true);
        t.start();
    }

    static String subject(String shard) {
        return "geldar." + shard + ".maintenance";
    }

    private void connect(
            String url, String shard, Function<String, String> setting, Logger log, MaintenanceNotices notices) {
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
            nc.createDispatcher(m -> notices.receive(new String(m.getData(), StandardCharsets.UTF_8)))
                    .subscribe(subject(shard));
            connection = nc;
        } catch (Exception e) {
            log.warning("Maintenance notices cannot reach NATS: " + e.getClass().getSimpleName());
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
