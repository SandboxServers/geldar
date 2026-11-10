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
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import java.util.function.Supplier;
import org.slf4j.Logger;

/**
 * Keeps a {@link Feed} (the {@link LifeRegistry}, or the {@link SkinRegistry}) in step with a JetStream KV bucket.
 * The life registry is the default bucket {@code geldar-life-registry}, created by Golem; a second client watches
 * {@code geldar-skins}. A daemon thread connects with backoff and watches the bucket. When the bucket is absent the
 * feed stays unsynced (the gate stays closed, no skin is set) and the thread retries.
 */
public final class RegistryClient implements AutoCloseable {
    public static final String BUCKET = "geldar-life-registry";

    /** Receives the bucket's changes: the registries implement it. */
    public interface Feed {
        void beginReplay();

        void put(String key, byte[] value);

        void remove(String key);

        void markSynced();

        void markUnsynced();
    }

    /** Short, so a first denial caused by a slow start does not last long. */
    private static final long MAX_BACKOFF_MS = 5_000;
    private static final long INITIAL_BACKOFF_MS = 500;
    /** JetStream API error code for "stream not found": the bucket does not exist yet. */
    private static final int STREAM_NOT_FOUND = 10059;
    /** How often the watch loop checks that the bucket is still the one it is watching. */
    private static final long BUCKET_CHECK_MS = 30_000;
    private static final long POLL_MS = 500;

    private final String url;
    private final String bucket;
    private final Feed registry;
    private final Logger log;
    private final Thread worker;
    private volatile boolean running = true;
    /** Set when the connection dropped: the watch may have missed changes and is rebuilt. */
    private final AtomicBoolean disrupted = new AtomicBoolean();
    /** The reconnect delay; touched only by the worker thread. */
    long backoffMs = INITIAL_BACKOFF_MS;

    public RegistryClient(String url, LifeRegistry registry, Logger log) {
        this(url, BUCKET, registry, log);
    }

    public RegistryClient(String url, String bucket, Feed feed, Logger log) {
        this.url = url;
        this.bucket = bucket;
        this.registry = feed;
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
            try (Connection nc = Nats.connect(connectOptions())) {
                KeyValue kv = nc.keyValue(bucket);
                watchWhileConnected(nc::getStatus, bucketOf(kv), this::resetBackoff, POLL_MS, BUCKET_CHECK_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                // The message is left out: a connection error can echo the URL.
                if (bucketAbsent(e)) {
                    log.warn("Bucket {} is absent, retrying in {} ms", bucket, backoffMs);
                } else {
                    log.warn("Bucket {} unavailable ({}), retrying in {} ms", bucket, e.getClass().getSimpleName(), backoffMs);
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

    /** Runs once a watch has started: the next failure backs off from the start again. */
    void resetBackoff() {
        backoffMs = INITIAL_BACKOFF_MS;
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

    /** The connect options, with credentials when configured; read on each attempt, inside its try. */
    Options connectOptions() {
        return withCredentials(
                        Options.builder()
                                .server(url)
                                .connectionTimeout(Duration.ofSeconds(5))
                                .maxReconnects(-1)
                                .connectionListener(this::onConnectionEvent),
                        RegistryClient::setting)
                .build();
    }

    /**
     * Adds the NATS user and password of decision 0067 when they are set: {@code GELDAR_NATS_USER}
     * and {@code GELDAR_NATS_PASSWORD_FILE} (a file holding the password), read by {@code setting}.
     * Unset, the connection stays unauthenticated. Errors name a setting or a path, never a password.
     */
    static Options.Builder withCredentials(Options.Builder builder, Function<String, String> setting) {
        String user = setting.apply("GELDAR_NATS_USER");
        String passwordFile = setting.apply("GELDAR_NATS_PASSWORD_FILE");
        if (isBlank(user) && isBlank(passwordFile)) return builder;
        if (isBlank(user)) throw new IllegalStateException("GELDAR_NATS_PASSWORD_FILE is set but GELDAR_NATS_USER is not");
        if (isBlank(passwordFile)) throw new IllegalStateException("GELDAR_NATS_USER is set but GELDAR_NATS_PASSWORD_FILE is not");
        String password;
        try {
            password = Files.readString(Path.of(passwordFile), StandardCharsets.UTF_8).trim();
        } catch (IOException | InvalidPathException e) {
            throw new IllegalStateException("cannot read the NATS password file named by GELDAR_NATS_PASSWORD_FILE: " + passwordFile);
        }
        if (password.isEmpty()) throw new IllegalStateException("the NATS password file named by GELDAR_NATS_PASSWORD_FILE is empty");
        return builder.userInfo(user, password);
    }

    /** A setting from the environment, else from the system property of the same name. */
    static String setting(String name) {
        String value = System.getenv(name);
        return value != null ? value : System.getProperty(name);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
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
            // Cleared first: a disconnect between the two calls must survive, or the gate would stay closed for good.
            disrupted.set(false);
            registry.beginReplay();
            Object identity = bucket.identity();
            AutoCloseable sub = bucket.watchAll(new RegistryWatch());
            watching.run();
            log.info("Watching bucket {}", bucket);
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

    void onConnectionEvent(Connection connection, ConnectionListener.Events event) {
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
    static void apply(Feed registry, KeyValueOperation operation, String key, byte[] value) {
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
