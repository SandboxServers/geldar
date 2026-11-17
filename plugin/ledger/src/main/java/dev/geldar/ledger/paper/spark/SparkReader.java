package dev.geldar.ledger.paper.spark;

import java.util.List;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Reads spark's API summaries through a seam. This class never names a spark class: spark's types live only in
 * {@link SparkApiAdapter}, which is loaded after a {@code Class.forName} guard finds spark (soft dependency, PT-04c).
 * When spark is absent, or its provider is not ready, the reader returns nothing and retries at most every 60 s.
 */
final class SparkReader {
    static final String PROVIDER_CLASS = "me.lucko.spark.api.SparkProvider";
    static final long RETRY_NANOS = 60_000_000_000L;

    /** One gauge reading: the metric name, its attribute key/value pairs and the value. */
    record Point(String metric, String[] attrs, double value) {
        String key() {
            return metric + String.join("|", attrs);
        }
    }

    /** What the spark side offers. Throws when the provider is not ready (spark's {@code IllegalStateException}). */
    interface Api {
        List<Point> read() throws Exception;
    }

    private final Supplier<Api> resolver;
    private final LongSupplier nanoClock;
    private Api api;
    private boolean tried;
    private long lastTry;

    SparkReader(Supplier<Api> resolver, LongSupplier nanoClock) {
        this.resolver = resolver;
        this.nanoClock = nanoClock;
    }

    /** Production resolver: null when the spark API class cannot be found by {@code loader}. Never loads spark classes then. */
    static Supplier<Api> production(ClassLoader loader) {
        return () -> {
            try {
                Class.forName(PROVIDER_CLASS, false, loader);
            } catch (ClassNotFoundException | LinkageError e) {
                return null;
            }
            return new SparkApiAdapter();
        };
    }

    /** Async thread only. Never throws; an empty list means nothing to report. */
    List<Point> poll() {
        try {
            if (api == null) {
                long now = nanoClock.getAsLong();
                if (tried && now - lastTry < RETRY_NANOS) {
                    return List.of();
                }
                tried = true;
                lastTry = now;
                api = resolver.get();
                if (api == null) {
                    return List.of();
                }
            }
            return api.read();
        } catch (Throwable t) {
            // provider not ready or spark went away: report nothing and look again after the retry delay
            api = null;
            return List.of();
        }
    }
}
