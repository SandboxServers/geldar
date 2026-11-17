package dev.geldar.core.trace;

import dev.geldar.core.NatsEventPublisher;
import dev.geldar.core.blockowner.OwnerQueryService;
import dev.geldar.core.kino.NatsKinoSink;
import dev.geldar.core.proximity.NatsHearingSink;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.metrics.Meter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Geldar-Core's own counters over the OpenTelemetry API (PT-11e, PT-11e2). Each is an observable instrument that
 * reads an accessor the sinks expose, so no counting point does any metric work. No attributes are ever attached: no
 * agent, life id, viewer, player or speech hash. With no OpenTelemetry agent the API is a no-op and nothing is
 * recorded.
 */
public final class CoreMetrics {
    public static final String PUBLISHER_PUBLISHED = "geldar_publisher_published_total";
    public static final String PUBLISHER_FAILED = "geldar_publisher_failed_total";
    public static final String PUBLISHER_DROPPED = "geldar_publisher_dropped_total";
    public static final String PUBLISHER_QUEUE_DEPTH = "geldar_publisher_queue_depth";
    public static final String HEARING_SENT = "geldar_hearing_sent_total";
    public static final String HEARING_DROPPED = "geldar_hearing_dropped_total";
    public static final String BLOCKOWNER_QUERIES = "geldar_blockowner_queries_total";
    public static final String BLOCKOWNER_CACHE_HITS = "geldar_blockowner_cache_hits_total";
    public static final String BLOCKOWNER_FAILURES = "geldar_blockowner_failures_total";
    public static final String KINO_PUBLISHED = "geldar_kino_published_total";
    public static final String KINO_DROPPED = "geldar_kino_dropped_total";

    private CoreMetrics() {}

    /** What one {@code register} call created; closing it stops the callbacks and releases the sinks they hold. */
    public static final class Registration implements AutoCloseable {
        private final List<AutoCloseable> instruments;

        Registration(List<AutoCloseable> instruments) {
            this.instruments = instruments;
        }

        @Override
        public void close() {
            for (AutoCloseable instrument : instruments) {
                try {
                    instrument.close();
                } catch (Exception e) {
                    // Closing a metric never matters more than the shutdown it is part of.
                }
            }
            instruments.clear();
        }
    }

    /**
     * Registers the instruments on the global meter. A null source skips its instruments. Close the result when the
     * plugin is disabled, so a later enable (a reload) registers its own sinks again.
     */
    public static Registration register(
            NatsEventPublisher publisher, NatsHearingSink hearing, NatsKinoSink kino, OwnerQueryService owners) {
        return register(GlobalOpenTelemetry.getMeter("geldar-core"), publisher, hearing, kino, owners);
    }

    static Registration register(Meter meter, NatsEventPublisher publisher, NatsHearingSink hearing,
            NatsKinoSink kino, OwnerQueryService owners) {
        Map<String, LongSupplier> counters = new LinkedHashMap<>();
        Map<String, LongSupplier> gauges = new LinkedHashMap<>();
        if (publisher != null) {
            counters.put(PUBLISHER_PUBLISHED, publisher::published);
            counters.put(PUBLISHER_FAILED, publisher::failed);
            counters.put(PUBLISHER_DROPPED, publisher::dropped);
            gauges.put(PUBLISHER_QUEUE_DEPTH, publisher::queued);
        }
        if (hearing != null) {
            counters.put(HEARING_SENT, hearing::sent);
            counters.put(HEARING_DROPPED, hearing::dropped);
        }
        if (owners != null) {
            counters.put(BLOCKOWNER_QUERIES, owners::queries);
            counters.put(BLOCKOWNER_CACHE_HITS, owners::cacheHits);
            counters.put(BLOCKOWNER_FAILURES, owners::failures);
        }
        if (kino != null) {
            counters.put(KINO_PUBLISHED, kino::published);
            counters.put(KINO_DROPPED, kino::dropped);
        }
        List<AutoCloseable> instruments = new ArrayList<>();
        instruments.addAll(registerOn(meter, counters));
        instruments.addAll(registerGaugesOn(meter, gauges));
        return new Registration(instruments);
    }

    /** Creates one attribute-free observable counter per source on the given meter. */
    static List<AutoCloseable> registerOn(Meter meter, Map<String, LongSupplier> sources) {
        List<AutoCloseable> created = new ArrayList<>();
        sources.forEach((name, source) -> created.add(meter.counterBuilder(name)
                .buildWithCallback(m -> m.record(source.getAsLong()))));
        return created;
    }

    /** Creates one attribute-free observable long gauge per source on the given meter. */
    static List<AutoCloseable> registerGaugesOn(Meter meter, Map<String, LongSupplier> sources) {
        List<AutoCloseable> created = new ArrayList<>();
        sources.forEach((name, source) -> created.add(meter.gaugeBuilder(name).ofLongs()
                .buildWithCallback(m -> m.record(source.getAsLong()))));
        return created;
    }
}
