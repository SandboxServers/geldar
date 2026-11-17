package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import jdk.jfr.consumer.RecordedEvent;

/**
 * Records the duration of {@code jdk.SafepointBegin} and {@code jdk.SafepointEnd} (threshold 10 ms) in
 * {@code geldar_jfr_safepoint_ms}. Reads only the fields in {@link #FIELDS}.
 */
public final class SafepointHandler implements JfrHandler {
    static final String BEGIN = "jdk.SafepointBegin";
    static final String END = "jdk.SafepointEnd";
    static final Set<String> FIELDS = Set.of("duration");
    static final double[] BOUNDS = {10, 20, 50, 100, 250, 500, 1000, 5000};

    private final BoundHistogram histogram;

    public SafepointHandler(Ledger ledger) {
        this.histogram = ledger.histogram(
                        Names.Jfr.SAFEPOINT_MS, "ms", "Safepoint begin and end durations over the JFR threshold", BOUNDS)
                .bind();
    }

    @Override
    public List<String> eventNames() {
        return List.of(BEGIN, END);
    }

    @Override
    public void handle(RecordedEvent event) {
        handle(event.getEventType().getName(), f -> event.getValue(f));
    }

    void handle(String eventName, Function<String, Object> field) {
        if (!BEGIN.equals(eventName) && !END.equals(eventName)) {
            return;
        }
        if (field.apply("duration") instanceof Duration d) {
            histogram.record(d.toNanos() / 1_000_000.0);
        }
    }
}
