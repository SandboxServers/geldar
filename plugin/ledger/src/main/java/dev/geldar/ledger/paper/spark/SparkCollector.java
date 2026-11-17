package dev.geldar.ledger.paper.spark;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.Ledger;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.DoubleSupplier;

/**
 * {@code geldar_spark_*} gauges from spark's API summaries (PT-04c). Spark is a soft dependency: with it absent the
 * collector starts, registers nothing and emits nothing. Gauges are registered on the async thread the first time
 * a reading appears; the exporter-thread readers return the last stored value. Never starts a profiler (S11).
 */
public final class SparkCollector implements Collector {
    public static final String ID = "spark";
    public static final long PERIOD_MS = 15_000;

    private final SparkReader reader;
    private final Map<String, Double> values = new ConcurrentHashMap<>();
    private Cancellable task;

    /** Production constructor, used by reflection from the collector factory. */
    public SparkCollector() {
        this(new SparkReader(SparkReader.production(SparkCollector.class.getClassLoader()), System::nanoTime));
    }

    SparkCollector(SparkReader reader) {
        this.reader = reader;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger ledger = ctx.ledger();
        task = ctx.scheduler().everyMillis(PERIOD_MS, () -> refresh(ledger));
    }

    /** Async thread. Never throws. */
    void refresh(Ledger ledger) {
        try {
            List<SparkReader.Point> points = reader.poll();
            for (SparkReader.Point p : points) {
                String key = p.key();
                if (values.put(key, p.value()) == null) {
                    DoubleSupplier reader = () -> values.getOrDefault(key, 0.0);
                    ledger.gaugeDouble(p.metric(), "1", "spark summary", reader, p.attrs());
                }
            }
        } catch (Throwable t) {
            // keep the previous values
        }
    }

    @Override
    public synchronized void stop() {
        Cancellable t = task;
        task = null;
        if (t != null) {
            t.cancel();
        }
    }
}
