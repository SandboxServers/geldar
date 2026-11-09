package dev.geldar.core;

import io.nats.client.Connection;
import io.nats.client.JetStream;
import io.nats.client.JetStreamApiException;
import io.nats.client.JetStreamManagement;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.api.RetentionPolicy;
import io.nats.client.api.StorageType;
import io.nats.client.api.StreamConfiguration;
import io.nats.client.impl.Headers;
import io.nats.client.support.NatsJetStreamConstants;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;
import java.util.logging.Logger;

/**
 * Publishes into JetStream stream {@code GELDAR_EVENTS}. {@link #publish} only enqueues; a daemon
 * thread connects (with backoff), creates the stream if missing, and drains the queue. A failed
 * publish goes back to the head of the queue; the {@code Nats-Msg-Id} header makes a retry idempotent.
 */
public final class NatsEventPublisher implements EventPublisher {
    public static final String STREAM = "GELDAR_EVENTS";

    private final String url;
    private final Logger log;
    private final BoundedEventQueue<EventEnvelope> queue;
    private final Thread worker;
    private final AtomicLong published = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private static final long FAILURE_PAUSE_MS = 250;
    private static final long DROP_LOG_INTERVAL_MS = 60_000;
    private static final long CLOSE_FLUSH_MS = 2_000;
    /** Failed sends in a row after which the worker reconnects and re-checks the stream. */
    static final int MAX_CONSECUTIVE_FAILURES = 20;

    private long loggedDrops;
    private long lastDropLogNanos = System.nanoTime();
    private volatile boolean running = true;
    private volatile boolean connected;
    private int consecutiveFailures;

    public NatsEventPublisher(String url, int queueCapacity, Logger log) {
        this.url = url;
        this.log = log;
        this.queue = new BoundedEventQueue<>(queueCapacity);
        this.worker = new Thread(this::run, "geldar-nats-publisher");
        this.worker.setDaemon(true);
        this.worker.start();
    }

    @Override
    public void publish(EventEnvelope event) {
        queue.offer(event);
    }

    /** How many events were discarded because the queue was full. */
    @Override
    public long dropped() {
        return queue.dropped();
    }

    /** How many events JetStream has acknowledged. */
    public long published() {
        return published.get();
    }

    /** How many publish attempts failed (each failed event is retried). */
    public long failed() {
        return failed.get();
    }

    /** True while the worker holds a live connection with the stream in place. */
    @Override
    public boolean connected() {
        return connected;
    }

    /** The headers sent with an event: {@code Nats-Msg-Id} is the {@code source_event_id}, for de-duplication. */
    static Headers headers(EventEnvelope event) {
        return new Headers().put(NatsJetStreamConstants.MSG_ID_HDR, event.sourceEventId());
    }

    private void run() {
        long backoffMs = 500;
        while (running) {
            try (Connection nc = Nats.connect(Options.builder().server(url).connectionTimeout(Duration.ofSeconds(5)).build())) {
                JetStream js = nc.jetStream();
                ensureStream(nc.jetStreamManagement());
                connected = true;
                consecutiveFailures = 0;
                backoffMs = 500;
                log.info("Connected to NATS, publishing into " + STREAM);
                drain(nc, js);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                log.warning("NATS unavailable (" + e.getClass().getSimpleName() + "), retrying in " + backoffMs + " ms");
            } finally {
                connected = false;
            }
            logDrops();
            if (!running) {
                return;
            }
            try {
                Thread.sleep(backoffMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            backoffMs = Math.min(backoffMs * 2, 30_000);
        }
    }

    private void ensureStream(JetStreamManagement jsm) throws IOException, JetStreamApiException {
        try {
            jsm.getStreamInfo(STREAM);
        } catch (JetStreamApiException e) {
            if (e.getApiErrorCode() != 10059) {
                throw e;
            }
            jsm.addStream(StreamConfiguration.builder()
                    .name(STREAM)
                    .subjects("geldar.*.*")
                    .storageType(StorageType.File)
                    .retentionPolicy(RetentionPolicy.Limits)
                    .maxAge(Duration.ofDays(30))
                    .build());
            log.info("Created JetStream stream " + STREAM);
        }
    }

    private void drain(Connection nc, JetStream js) throws InterruptedException, IOException {
        Sender sender = (subject, headers, body) -> js.publish(subject, headers, body);
        sendWhileConnected(() -> nc.getStatus() == Connection.Status.CONNECTED, sender, FAILURE_PAUSE_MS);
        flushOnClose(nc, sender);
    }

    /**
     * Sends queued events while {@code connected} holds; throws after {@link #MAX_CONSECUTIVE_FAILURES} failed
     * sends in a row so that the worker reconnects, pausing {@code pauseMs} after each failure.
     */
    void sendWhileConnected(BooleanSupplier connected, Sender sender, long pauseMs) throws InterruptedException, IOException {
        while (running && connected.getAsBoolean()) {
            logDrops();
            EventEnvelope event = queue.poll(500, TimeUnit.MILLISECONDS);
            if (event == null) {
                continue;
            }
            if (!attempt(sender, event)) {
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    // The connection can look fine while the stream is gone; reconnecting re-runs ensureStream.
                    throw new IOException("publishing failed " + consecutiveFailures + " times in a row");
                }
                Thread.sleep(pauseMs);
            }
        }
    }

    /** Sends one event; a failed event goes back to the head of the queue and counts toward a reconnect. */
    boolean attempt(Sender sender, EventEnvelope event) {
        if (send(sender, event)) {
            consecutiveFailures = 0;
            return true;
        }
        consecutiveFailures++;
        queue.offerFirst(event);
        return false;
    }

    /** On shutdown, sends what is still queued (a final death must not be lost), for a bounded time. */
    private void flushOnClose(Connection nc, Sender sender) throws InterruptedException {
        flush(sender, () -> nc.getStatus() == Connection.Status.CONNECTED, CLOSE_FLUSH_MS);
    }

    /** Sends queued events while {@code connected} holds and the budget lasts; stops at the first failure. */
    void flush(Sender sender, BooleanSupplier connected, long budgetMs) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs);
        while (connected.getAsBoolean() && System.nanoTime() < deadline) {
            EventEnvelope event = queue.poll(0, TimeUnit.MILLISECONDS);
            if (event == null) {
                return;
            }
            if (!send(sender, event)) {
                queue.offerFirst(event);
                return;
            }
        }
    }

    /** The one call that reaches JetStream; a seam so the retry paths can be tested without a server. */
    @FunctionalInterface
    interface Sender {
        void publish(String subject, Headers headers, byte[] body) throws Exception;
    }

    private boolean send(Sender sender, EventEnvelope event) {
        try {
            sender.publish(event.subject(), headers(event), event.toBytes());
            published.incrementAndGet();
            return true;
        } catch (Exception e) {
            failed.incrementAndGet();
            log.warning("Publish of " + event.sourceEventId() + " failed, will retry: " + e.getMessage());
            return false;
        }
    }

    /** Failed sends in a row since the last success. */
    int consecutiveFailures() {
        return consecutiveFailures;
    }

    /** The events waiting to be sent. */
    int queued() {
        return queue.size();
    }

    /** Logs the drop count when it changed, at most once a minute. */
    private void logDrops() {
        long now = System.nanoTime();
        long dropped = queue.dropped();
        if (dropped != loggedDrops && now - lastDropLogNanos >= TimeUnit.MILLISECONDS.toNanos(DROP_LOG_INTERVAL_MS)) {
            log.warning("Event queue full: " + dropped + " events dropped so far (" + (dropped - loggedDrops) + " since the last report)");
            loggedDrops = dropped;
            lastDropLogNanos = now;
        }
    }

    /** Stops delivery after sending what is queued (up to two seconds), then releases the connection. */
    @Override
    public void close() {
        running = false;
        if (!connected) {
            worker.interrupt();
        }
        try {
            worker.join(CLOSE_FLUSH_MS + 1_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        worker.interrupt();
    }
}
