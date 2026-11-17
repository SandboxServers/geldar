package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import jdk.jfr.consumer.RecordedEvent;

/**
 * Turns {@code jdk.ExceptionStatistics} (period 60 s, a cumulative count) into the delta added to
 * {@code geldar_jfr_exceptions_total{kind=thrown}}. {@code jdk.JavaExceptionThrow} is denied (very high rate). The
 * first sample is the baseline and adds nothing; a counter that goes down (a JVM restart is impossible in-process, but
 * be safe) re-baselines.
 */
public final class ExceptionHandler implements JfrHandler {
    static final String EVENT = "jdk.ExceptionStatistics";
    static final Set<String> FIELDS = Set.of("throwables");

    private final BoundCounter thrown;
    private long last = -1;

    public ExceptionHandler(Ledger ledger) {
        this.thrown = ledger.counter(
                        Names.Jfr.EXCEPTIONS_TOTAL, "1", "Throwables created in the JVM (JFR statistics delta)", "kind")
                .bind("thrown");
    }

    @Override
    public List<String> eventNames() {
        return List.of(EVENT);
    }

    @Override
    public void handle(RecordedEvent event) {
        handle(event.getEventType().getName(), f -> event.getValue(f));
    }

    synchronized void handle(String eventName, Function<String, Object> field) {
        if (!EVENT.equals(eventName) || !(field.apply("throwables") instanceof Number n)) {
            return;
        }
        long now = n.longValue();
        if (last >= 0 && now > last) {
            thrown.add(now - last);
        }
        last = now;
    }
}
