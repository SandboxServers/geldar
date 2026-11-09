package dev.geldar.identity;

import io.nats.client.Connection;
import io.nats.client.ConnectionListener;
import io.nats.client.JetStreamApiException;
import io.nats.client.KeyValue;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.api.KeyValueEntry;
import io.nats.client.api.KeyValueOperation;
import io.nats.client.api.KeyValueWatcher;
import io.nats.client.impl.NatsKeyValueWatchSubscription;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.slf4j.Logger;

/**
 * Keeps a {@link LifeRegistry} in step with the JetStream KV bucket {@code geldar-life-registry}.
 * A daemon thread connects with backoff and watches the bucket. The bucket is created by Golem;
 * when it is absent the registry stays unsynced (the gate stays closed) and the thread retries.
 */
public final class RegistryClient implements AutoCloseable {
    public static final String BUCKET = "geldar-life-registry";

    /** Short, so a first denial caused by a slow start does not last long. */
    private static final long MAX_BACKOFF_MS = 5_000;
    private static final long INITIAL_BACKOFF_MS = 500;
    /** JetStream API error code for "stream not found": the bucket does not exist yet. */
    private static final int STREAM_NOT_FOUND = 10059;
    /** How often the watch loop checks that the bucket is still the one it is watching. */
    private static final long BUCKET_CHECK_MS = 30_000;
    private static final long POLL_MS = 500;

    private final String url;
    private final LifeRegistry registry;
    private final Logger log;
    private final Thread worker;
    private volatile boolean running = true;
    /** Set when the connection dropped: the watch may have missed changes and is rebuilt. */
    private final AtomicBoolean disrupted = new AtomicBoolean();
    /** The reconnect delay; touched only by the worker thread. */
    private long backoffMs = INITIAL_BACKOFF_MS;

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
        while (running) {
            registry.markUnsynced();
            disrupted.set(false);
            Options options = Options.builder()
                    .server(url)
                    .connectionTimeout(Duration.ofSeconds(5))
                    .maxReconnects(-1)
                    .connectionListener(this::onConnectionEvent)
                    .build();
            try (Connection nc = Nats.connect(options)) {
                KeyValue kv = nc.keyValue(BUCKET);
                watchWhileConnected(nc::getStatus, bucketOf(kv), () -> backoffMs = INITIAL_BACKOFF_MS, POLL_MS, BUCKET_CHECK_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                // The message is left out: a connection error can echo the URL.
                if (bucketAbsent(e)) {
                    log.warn("Life registry bucket {} is absent (Golem creates it), retrying in {} ms", BUCKET, backoffMs);
                } else {
                    log.warn("Life registry unavailable ({}), retrying in {} ms", e.getClass().getSimpleName(), backoffMs);
                }
            }
            registry.markUnsynced();
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

    /** What a bucket watch reports: each change, then the end of the initial replay. */
    interface Watch {
        void change(KeyValueOperation operation, String key, byte[] value);

        void endOfData();
    }

    /** The slice of the KV bucket the watch loop uses (a fake in tests). */
    interface Bucket {
        /** Starts the watch; the handle closes it. Throws when the bucket is absent. */
        AutoCloseable watchAll(Watch watch) throws Exception;

        /** A value that differs once the bucket is deleted and recreated; throws when it is absent. */
        Object identity() throws Exception;
    }

    static Bucket bucketOf(KeyValue kv) {
        return new Bucket() {
            @Override
            public AutoCloseable watchAll(Watch watch) throws Exception {
                return kv.watchAll(new KeyValueWatcher() {
                    @Override
                    public void watch(KeyValueEntry entry) {
                        watch.change(entry.getOperation(), entry.getKey(), entry.getValue());
                    }

                    @Override
                    public void endOfData() {
                        watch.endOfData();
                    }
                });
            }

            @Override
            public Object identity() throws Exception {
                return kv.getStatus().getBackingStreamInfo().getCreateTime();
            }
        };
    }

    /**
     * Watches the bucket until the connection closes. A disconnect or a dead watch closes the gate; once the
     * connection is back the bucket is replayed into a fresh map, so a revocation made meanwhile is applied.
     * Every {@code checkMs} the bucket is probed: if it is gone or was recreated (its stream has a new identity),
     * the gate closes and the loop ends or re-watches, since a live connection would not notice either.
     * {@code watching} runs once a watch has started.
     */
    void watchWhileConnected(Supplier<Connection.Status> status, Bucket bucket, Runnable watching, long pollMs, long checkMs)
            throws Exception {
        while (running && status.get() != Connection.Status.CLOSED) {
            registry.beginReplay();
            disrupted.set(false);
            Object identity = bucket.identity();
            AutoCloseable sub = bucket.watchAll(new RegistryWatch());
            watching.run();
            log.info("Watching the life registry");
            try {
                long nextCheck = System.nanoTime() + checkMs * 1_000_000;
                while (running && status.get() != Connection.Status.CLOSED && !disrupted.get()) {
                    Thread.sleep(pollMs);
                    if (System.nanoTime() - nextCheck >= 0) {
                        nextCheck = System.nanoTime() + checkMs * 1_000_000;
                        if (!identity.equals(bucket.identity())) {
                            log.warn("The life registry bucket was recreated, watching it again");
                            break;
                        }
                    }
                }
            } finally {
                registry.markUnsynced();
                try {
                    sub.close();
                } catch (Exception e) {
                    log.debug("Closing the registry watch failed ({})", e.getClass().getSimpleName());
                }
            }
            while (running && status.get() != Connection.Status.CLOSED && status.get() != Connection.Status.CONNECTED) {
                Thread.sleep(pollMs);
            }
        }
    }

    private void onConnectionEvent(Connection connection, ConnectionListener.Events event) {
        if (event == ConnectionListener.Events.DISCONNECTED || event == ConnectionListener.Events.CLOSED) {
            registry.markUnsynced();
            disrupted.set(true);
        }
    }

    /** True when the failure is "the bucket's stream does not exist". */
    static boolean bucketAbsent(Throwable error) {
        for (Throwable t = error; t != null; t = t.getCause()) {
            if (t instanceof JetStreamApiException api && api.getApiErrorCode() == STREAM_NOT_FOUND) {
                return true;
            }
        }
        return false;
    }

    /** Applies one bucket change to the registry: a put sets the entry, anything else (delete, purge) revokes it. */
    static void apply(LifeRegistry registry, KeyValueOperation operation, String key, byte[] value) {
        if (operation == KeyValueOperation.PUT) {
            registry.put(key, value);
        } else {
            registry.remove(key);
        }
    }

    /** Feeds bucket changes into the registry; the end of the replay opens the gate. */
    private final class RegistryWatch implements Watch {
        @Override
        public void change(KeyValueOperation operation, String key, byte[] value) {
            apply(registry, operation, key, value);
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
