package dev.geldar.ledger.core.jfr;

import java.util.List;
import jdk.jfr.consumer.RecordedEvent;

/**
 * A consumer of JFR events, plugged into {@link JfrRunner}. The runner enables only the events handlers name here, with
 * the period or threshold {@link JfrSettings} holds for them. {@link #handle} runs on the {@code ledger-jfr} thread
 * and may throw: the runner catches, counts and carries on.
 */
public interface JfrHandler {
    /** The JFR event names this handler wants, e.g. {@code jdk.JavaMonitorEnter}. */
    List<String> eventNames();

    /** Called once per recorded event whose name is in {@link #eventNames()} and that the runner enabled. */
    void handle(RecordedEvent event);
}
