package dev.geldar.core.blockowner;

import dev.geldar.core.trace.TraceHook;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Message;
import io.nats.client.Options;
import io.nats.client.impl.Headers;
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
    private volatile TraceHook trace = TraceHook.NOOP;
    /** Query contexts waiting for their reply, by reply inbox; bounded so an unanswered query cannot leak. */
    private final java.util.Map<String, TraceHook.Captured> contexts = new java.util.LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(java.util.Map.Entry<String, TraceHook.Captured> eldest) {
            return size() > MAX_PENDING_CONTEXTS;
        }
    };
    static final int MAX_PENDING_CONTEXTS = 1024;

    public NatsBlockOwnerLink(String url, String shard, Function<String, String> setting, Logger log) {
        this.url = url;
        this.shard = shard;
        this.setting = setting;
        this.log = log;
    }

    public void setTrace(TraceHook hook) {
        trace = hook == null ? TraceHook.NOOP : hook;
    }

    /** Test seam: uses this connection instead of connecting. */
    void attach(Connection nc) {
        connection = nc;
    }

    void handle(Message m, BiConsumer<String, String> onQuery) {
        TraceHook.Scope scope = TraceHook.Scope.NONE;
        try {
            TraceHook.Scope entered = trace.enter(m.getHeaders());
            if (entered != null) {
                scope = entered;
            }
            // The reply is sent later, on the lookup thread, where this scope is gone: keep the query's context.
            TraceHook.Captured captured = trace.capture();
            if (captured != null && m.getReplyTo() != null) {
                synchronized (contexts) {
                    contexts.put(m.getReplyTo(), captured);
                }
            }
        } catch (Throwable e) {
            if (e instanceof VirtualMachineError vm) {
                throw vm;
            }
            // A telemetry failure never drops a query.
        }
        try {
            onQuery.accept(m.getReplyTo(), new String(m.getData(), StandardCharsets.UTF_8));
        } finally {
            try {
                scope.close();
            } catch (Throwable e) {
                if (e instanceof VirtualMachineError vm) {
                    throw vm;
                }
            }
        }
    }

    /** The trace headers for the reply to {@code replyTo}, or null: never throws. */
    private Headers replyHeaders(String replyTo) {
        try {
            TraceHook.Captured captured;
            synchronized (contexts) {
                captured = contexts.remove(replyTo);
            }
            return captured != null ? trace.inject(null, captured) : trace.inject(null);
        } catch (Throwable e) {
            if (e instanceof VirtualMachineError vm) {
                throw vm;
            }
            return null;
        }
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
            nc.createDispatcher(m -> handle(m, onQuery))
                    .subscribe(querySubject(shard));
            connection = nc;
        } catch (Exception e) {
            log.warning("Block ownership cannot reach NATS: " + e.getClass().getSimpleName());
        }
    }

    @Override
    public void reply(String replyTo, String json) {
        Connection nc = connection;
        if (nc == null) {
            return;
        }
        Headers headers = replyHeaders(replyTo);
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (headers == null) {
            nc.publish(replyTo, body);
        } else {
            nc.publish(replyTo, headers, body);
        }
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
