package dev.geldar.neoforge;

import dev.geldar.core.EventEnvelope;
import dev.geldar.core.EventPublisher;
import dev.geldar.core.NatsEventPublisher;
import java.util.logging.Logger;

/**
 * Starts the NATS publisher when the server starts and closes it when the server stops. {@link #publish} only
 * forwards to the publisher, which only enqueues; the connection, the retries and the flush all run on the
 * publisher's own thread. A failure to start leaves the server running with the export off.
 */
public final class ExportLifecycle {
    /** Opens the publisher. The production factory is {@link #natsPublisher()}; tests pass fakes. */
    @FunctionalInterface
    public interface PublisherFactory {
        EventPublisher open(ExportConfig config, Logger log);
    }

    private final ExportConfig config;
    private final PublisherFactory factory;
    private final OperatorSink sink;
    private volatile EventPublisher publisher;

    public ExportLifecycle(ExportConfig config, PublisherFactory factory, OperatorSink sink) {
        this.config = config;
        this.factory = factory;
        this.sink = sink;
    }

    /** The core-common NATS publisher, with the credentials handed to it as its settings (see below). */
    public static PublisherFactory natsPublisher() {
        return (config, log) -> {
            exposeCredentials(config);
            return new NatsEventPublisher(config.natsUrl(), config.queueCapacity(), log);
        };
    }

    /**
     * core-common reads GELDAR_NATS_USER and GELDAR_NATS_PASSWORD_FILE from the environment, else from a system
     * property of the same name. The file values from the properties file are set as those properties, only where
     * the environment does not set the name, so the environment still wins as on Paper. The password is never read here.
     */
    static void exposeCredentials(ExportConfig config) {
        if (config.natsUser() == null) {
            return;
        }
        if (System.getenv("GELDAR_NATS_USER") == null) {
            System.setProperty("GELDAR_NATS_USER", config.natsUser());
        }
        if (System.getenv("GELDAR_NATS_PASSWORD_FILE") == null) {
            System.setProperty("GELDAR_NATS_PASSWORD_FILE", config.passwordFile());
        }
    }

    public synchronized void start() {
        if (!config.enabled()) {
            sink.info("geldar_neoforge export disabled");
            return;
        }
        try {
            publisher = factory.open(config, OperatorLogBridge.loggerFor(sink));
            sink.info("geldar_neoforge export enabled, shard " + config.shard());
        } catch (RuntimeException e) {
            sink.warn("geldar_neoforge export could not start (" + e.getClass().getSimpleName() + "); the server runs without it");
        }
    }

    /** Hands one event to the publisher. Returns at once; never waits for NATS. */
    public void publish(EventEnvelope event) {
        EventPublisher current = publisher;
        if (current != null) {
            current.publish(event);
        }
    }

    /** Events the publisher has discarded so far; 0 when the export is off. */
    public long dropped() {
        EventPublisher current = publisher;
        return current == null ? 0L : current.dropped();
    }

    /** Whether the publisher can deliver now; false when the export is off. */
    public boolean connected() {
        EventPublisher current = publisher;
        return current != null && current.connected();
    }

    /** Closes the publisher, which flushes what it can for a bounded time, then releases the connection. */
    public synchronized void stop() {
        EventPublisher current = publisher;
        publisher = null;
        if (current == null) {
            return;
        }
        try {
            current.close();
            sink.info("geldar_neoforge export stopped, dropped " + current.dropped());
        } catch (RuntimeException e) {
            sink.warn("geldar_neoforge export did not close cleanly (" + e.getClass().getSimpleName() + ")");
        }
    }
}
