package dev.geldar.core.trace;

import dev.geldar.core.NatsEventPublisher;
import dev.geldar.core.kino.NatsKinoSink;
import dev.geldar.core.proximity.NatsHearingSink;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.metrics.Meter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/**
 * Geldar-Core's own counters over the OpenTelemetry API (PT-11e). Each is an observable counter that reads an
 * accessor the sinks already expose, so no counting point is edited. No attributes are ever attached: no agent,
 * life id, viewer or player. With no OpenTelemetry agent the API is a no-op and nothing is recorded.
 *
 * <p>Not countable from existing accessors (deferred to PT-11e2): publisher queue depth ({@code queued()} is
 * package-private), hearing notices sent, every block-owner counter, and Kino messages published.
 */
public final class CoreMetrics {
    public static final String PUBLISHER_PUBLISHED = "geldar_publisher_published_total";
    public static final String PUBLISHER_FAILED = "geldar_publisher_failed_total";
    public static final String PUBLISHER_DROPPED = "geldar_publisher_dropped_total";
    public static final String HEARING_DROPPED = "geldar_hearing_dropped_total";
    public static final String KINO_DROPPED = "geldar_kino_dropped_total";

    private static final AtomicBoolean REGISTERED = new AtomicBoolean();

    private CoreMetrics() {}

    /**
     * Registers the counters once; a second call changes nothing and returns false. A null sink skips its counters.
     * The orchestrator's follow-up adds one line to {@code GeldarCore.onEnable}, after the sinks exist:
     * {@code dev.geldar.core.trace.CoreMetrics.register(publisher, hearingSink, kinoSink);}
     */
    public static boolean register(NatsEventPublisher publisher, NatsHearingSink hearing, NatsKinoSink kino) {
        if (!REGISTERED.compareAndSet(false, true)) {
            return false;
        }
        Map<String, LongSupplier> sources = new LinkedHashMap<>();
        if (publisher != null) {
            sources.put(PUBLISHER_PUBLISHED, publisher::published);
            sources.put(PUBLISHER_FAILED, publisher::failed);
            sources.put(PUBLISHER_DROPPED, publisher::dropped);
        }
        if (hearing != null) {
            sources.put(HEARING_DROPPED, hearing::dropped);
        }
        if (kino != null) {
            sources.put(KINO_DROPPED, kino::dropped);
        }
        registerOn(GlobalOpenTelemetry.getMeter("geldar-core"), sources);
        return true;
    }

    /** Creates one attribute-free observable counter per source on the given meter. */
    static void registerOn(Meter meter, Map<String, LongSupplier> sources) {
        sources.forEach((name, source) -> meter.counterBuilder(name)
                .buildWithCallback(m -> m.record(source.getAsLong())));
    }

    /** Resets the once-only guard; for tests. */
    static void resetForTest() {
        REGISTERED.set(false);
    }
}
