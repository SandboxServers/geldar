package dev.geldar.core;

import io.nats.client.Connection;
import io.nats.client.JetStream;
import io.nats.client.JetStreamApiException;
import io.nats.client.JetStreamManagement;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.PublishOptions;
import io.nats.client.api.RetentionPolicy;
import io.nats.client.api.StorageType;
import io.nats.client.api.StreamConfiguration;
import io.nats.client.impl.Headers;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Publishes into JetStream stream {@code GELDAR_EVENTS}. {@link #publish} only enqueues; a daemon
 * thread connects (with backoff), creates the stream if missing, and drains the queue.
 */
public final class NatsEventPublisher implements EventPublisher {
    public static final String STREAM = "GELDAR_EVENTS";

    private final String url;
    private final Logger log;
    private final BoundedEventQueue<EventEnvelope> queue;
    private final Thread worker;
    private final AtomicLong published = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private volatile boolean running = true;
    private volatile boolean connected;

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

    public long dropped() {
        return queue.dropped();
    }

    public long published() {
        return published.get();
    }

    public long failed() {
        return failed.get();
    }

    public boolean connected() {
        return connected;
    }

    private void run() {
        long backoffMs = 500;
        while (running) {
            try (Connection nc = Nats.connect(Options.builder().server(url).connectionTimeout(Duration.ofSeconds(5)).build())) {
                JetStream js = nc.jetStream();
                ensureStream(nc.jetStreamManagement());
                connected = true;
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

    private void drain(Connection nc, JetStream js) throws InterruptedException {
        while (running && nc.getStatus() == Connection.Status.CONNECTED) {
            EventEnvelope event = queue.poll(500, TimeUnit.MILLISECONDS);
            if (event == null) {
                continue;
            }
            try {
                PublishOptions opts = PublishOptions.builder().messageId(event.sourceEventId()).build();
                js.publish(event.subject(), new Headers(), event.toBytes(), opts);
                published.incrementAndGet();
            } catch (Exception e) {
                failed.incrementAndGet();
                log.warning("Publish of " + event.sourceEventId() + " failed: " + e.getMessage());
            }
        }
    }

    @Override
    public void close() {
        running = false;
        worker.interrupt();
    }
}