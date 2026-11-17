package dev.geldar.core.maintenance;

import dev.geldar.core.trace.TraceHook;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.impl.Headers;
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
            String url, String shard, Function<String, String> setting, Logger log, MaintenanceNotices notices,
            TraceHook trace) {
        Thread t = new Thread(() -> connect(url, shard, setting, log, notices, trace), "geldar-maintenance");
        t.setDaemon(true);
        t.start();
    }

    static String subject(String shard) {
        return "geldar." + shard + ".maintenance";
    }

    private void connect(String url, String shard, Function<String, String> setting, Logger log,
            MaintenanceNotices notices, TraceHook trace) {
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
            nc.createDispatcher(m -> handle(m.getHeaders(), m.getData(), notices, trace)).subscribe(subject(shard));
            connection = nc;
        } catch (Exception e) {
            log.warning("Maintenance notices cannot reach NATS: " + e.getClass().getSimpleName());
        }
    }

    /**
     * Hands one notice on, inside the trace context its headers carry (only {@code traceparent} and
     * {@code tracestate}). With {@link TraceHook#NOOP} or no agent the notice is handled exactly as before.
     */
    static void handle(Headers headers, byte[] data, MaintenanceNotices notices, TraceHook trace) {
        TraceHook.Scope scope = enterTrace(headers, trace);
        try {
            notices.receive(new String(data, StandardCharsets.UTF_8));
        } finally {
            try {
                scope.close();
            } catch (Throwable e) {
                if (e instanceof VirtualMachineError vm) {
                    throw vm;
                }
                // Tracing must never break notice handling.
            }
        }
    }

    private static TraceHook.Scope enterTrace(Headers headers, TraceHook trace) {
        if (headers == null) {
            return TraceHook.Scope.NONE;
        }
        try {
            TraceHook.Scope scope = trace.enter(headers);
            return scope == null ? TraceHook.Scope.NONE : scope;
        } catch (Throwable e) {
            if (e instanceof VirtualMachineError vm) {
                throw vm;
            }
            return TraceHook.Scope.NONE;
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
