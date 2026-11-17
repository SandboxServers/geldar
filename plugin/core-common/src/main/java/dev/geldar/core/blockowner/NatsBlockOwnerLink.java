package dev.geldar.core.blockowner;

import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.logging.Logger;

/**
 * The NATS side of block ownership: subscribes to {@code geldar.<shard>.blockowner.query} and publishes the changes on
 * {@code geldar.<shard>.blockowner.changed} and the replies on the request's inbox. Connected on a daemon thread and
 * reconnects forever, like {@link dev.geldar.core.kino.NatsKinoSink}. A message with no connection is dropped.
 */
public final class NatsBlockOwnerLink implements BlockOwnerResponder.Reply, AutoCloseable {
    private final String url;
    private final String shard;
    private final Function<String, String> setting;
    private final Logger log;
    private volatile Connection connection;
    private volatile boolean closed;

    public NatsBlockOwnerLink(String url, String shard, Function<String, String> setting, Logger log) {
        this.url = url;
        this.shard = shard;
        this.setting = setting;
        this.log = log;
    }

    static String querySubject(String shard) {
        return "geldar." + shard + ".blockowner.query";
    }

    static String changedSubject(String shard) {
        return "geldar." + shard + ".blockowner.changed";
    }

    /** Starts the connection; each query body is handed to {@code onQuery} with its reply inbox, on the NATS thread. */
    public void start(BiConsumer<String, String> onQuery) {
        Thread t = new Thread(() -> connect(onQuery), "geldar-blockowner");
        t.setDaemon(true);
        t.start();
    }

    private void connect(BiConsumer<String, String> onQuery) {
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
            nc.createDispatcher(m -> onQuery.accept(m.getReplyTo(), new String(m.getData(), StandardCharsets.UTF_8)))
                    .subscribe(querySubject(shard));
            connection = nc;
        } catch (Exception e) {
            log.warning("Block ownership cannot reach NATS: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public void reply(String replyTo, String json) {
        publish(replyTo, json);
    }

    /** Publishes one change; called from the server thread by the publisher. */
    public void changed(String json) {
        publish(changedSubject(shard), json);
    }

    private void publish(String subject, String json) {
        Connection nc = connection;
        if (nc != null) {
            nc.publish(subject, json.getBytes(StandardCharsets.UTF_8));
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
