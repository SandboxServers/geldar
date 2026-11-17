package dev.geldar.neoforge;

import dev.geldar.core.maintenance.MaintenanceNotices;
import dev.geldar.core.maintenance.NatsMaintenanceSubscriber;
import dev.geldar.core.trace.TraceHook;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.logging.Logger;

/**
 * Subscribes to {@code geldar.<shard>.maintenance} while the export is on, and says each valid notice to everyone
 * online, as Paper does. Validation, dedupe and the rate limit are core-common's {@link MaintenanceNotices}, reused
 * unchanged. The connection is core-common's {@link NatsMaintenanceSubscriber}, with the export's credentials. The
 * broadcast is handed to the server thread through {@code mainThread}; it never runs on the NATS thread. With the
 * export off nothing is subscribed. Nothing here may stop the server.
 */
public final class MaintenanceLifecycle {
    /** Opens the subscription. The production factory is {@link #natsSubscriber()}; tests pass fakes. */
    @FunctionalInterface
    public interface SubscriberFactory {
        AutoCloseable open(
                String url, String shard, Function<String, String> setting, Logger log, MaintenanceNotices notices);
    }

    private final ExportConfig config;
    private final SubscriberFactory factory;
    private final Executor mainThread;
    private final Consumer<String> broadcast;
    private final Logger log;
    private final OperatorSink sink;
    private AutoCloseable subscriber;

    public MaintenanceLifecycle(
            ExportConfig config, SubscriberFactory factory, Executor mainThread, Consumer<String> broadcast,
            OperatorSink sink) {
        this.config = config;
        this.factory = factory;
        this.mainThread = mainThread;
        this.broadcast = broadcast;
        this.sink = sink;
        this.log = OperatorLogBridge.loggerFor(sink);
    }

    /** The core-common NATS subscriber. It connects on its own daemon thread and never throws for an outage. */
    public static SubscriberFactory natsSubscriber() {
        return (url, shard, setting, log, notices) ->
                new NatsMaintenanceSubscriber(url, shard, setting, log, notices, TraceHook.NOOP);
    }

    /** The subject of the maintenance notices for one shard; the contract's {@code maintenanceSubject(shard)}. */
    public static String subject(String shard) {
        return "geldar." + shard + ".maintenance";
    }

    /** core-common's setting reader: the environment, else a system property of the same name. */
    static String setting(String name) {
        String value = System.getenv(name);
        return value != null ? value : System.getProperty(name);
    }

    /** Subscribes only when the export is enabled. A failure leaves the server running without notices. */
    public synchronized void start() {
        if (!config.enabled()) {
            return;
        }
        try {
            ExportLifecycle.exposeCredentials(config);
            MaintenanceNotices notices = new MaintenanceNotices(
                    true, broadcast, mainThread, System::currentTimeMillis, log);
            subscriber = factory.open(config.natsUrl(), config.shard(), MaintenanceLifecycle::setting, log, notices);
            sink.info("geldar_neoforge maintenance notices on, subject " + subject(config.shard()));
        } catch (RuntimeException e) {
            sink.warn("geldar_neoforge maintenance notices could not start (" + e.getClass().getSimpleName()
                    + "); the server runs without them");
        }
    }

    /** Closes the subscription. Nothing is said after this returns from the NATS side. */
    public synchronized void stop() {
        AutoCloseable current = subscriber;
        subscriber = null;
        if (current == null) {
            return;
        }
        try {
            current.close();
            sink.info("geldar_neoforge maintenance notices off");
        } catch (Exception e) {
            sink.warn("geldar_neoforge maintenance notices did not close cleanly (" + e.getClass().getSimpleName()
                    + ")");
        }
    }
}
