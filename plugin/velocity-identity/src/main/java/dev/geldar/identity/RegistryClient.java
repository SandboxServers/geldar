package dev.geldar.identity;

import io.nats.client.Connection;
import io.nats.client.KeyValue;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.api.KeyValueEntry;
import io.nats.client.api.KeyValueOperation;
import io.nats.client.api.KeyValueWatcher;
import java.time.Duration;
import org.slf4j.Logger;

/**
 * Keeps a {@link LifeRegistry} in step with the JetStream KV bucket {@code geldar-life-registry}.
 * A daemon thread connects with backoff and watches the bucket. The bucket is created by Golem;
 * when it is absent the registry stays unsynced (the gate stays closed) and the thread retries.
 */
public final class RegistryClient implements AutoCloseable {
    public static final String BUCKET = "geldar-life-registry";

    private static final long MAX_BACKOFF_MS = 30_000;

    private final String url;
    private final LifeRegistry registry;
    private final Logger log;
    private final Thread worker;
    private volatile boolean running = true;

    public RegistryClient(String url, LifeRegistry registry, Logger log) {
        this.url = url;
        this.registry = registry;
        this.log = log;
        this.worker = new Thread(this::run, "geldar-registry-watcher");
        this.worker.setDaemon(true);
    }

    /** Starts the background thread; returns at once. */
    public void start() {
        worker.start();
    }

    private void run() {
        long backoffMs = 500;
        while (running) {
            Options options = Options.builder()
                    .server(url)
                    .connectionTimeout(Duration.ofSeconds(5))
                    .maxReconnects(-1)
                    .build();
            try (Connection nc = Nats.connect(options)) {
                KeyValue kv = nc.keyValue(BUCKET);
                kv.watchAll(new Watcher());
                backoffMs = 500;
                log.info("Watching the life registry");
                while (running && nc.getStatus() != Connection.Status.CLOSED) {
                    Thread.sleep(500);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                // The message is left out: a connection error can echo the URL.
                log.warn("Life registry unavailable ({}), retrying in {} ms", e.getClass().getSimpleName(), backoffMs);
            }
            if (!running) {
                return;
            }
            try {
                Thread.sleep(backoffMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
    }

    /** Feeds bucket changes into the registry; the end of the initial replay opens the gate. */
    private final class Watcher implements KeyValueWatcher {
        @Override
        public void watch(KeyValueEntry entry) {
            if (entry.getOperation() == KeyValueOperation.PUT) {
                registry.put(entry.getKey(), entry.getValue());
            } else {
                registry.remove(entry.getKey());
            }
        }

        @Override
        public void endOfData() {
            registry.markSynced();
        }
    }

    @Override
    public void close() {
        running = false;
        worker.interrupt();
    }
}
