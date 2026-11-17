package dev.geldar.ledger.core.jfr;

import java.util.List;
import java.util.Set;
import jdk.jfr.consumer.RecordedEvent;

/**
 * A consumer of JFR events, plugged into {@link JfrRunner}. The runner enables only the events handlers name here, with
 * the period or threshold {@link JfrSettings} holds for them. {@link #handle} runs on the {@code ledger-jfr} thread
 * and may throw: the runner catches, counts and carries on.
 *
 * <p>Privacy rule: a handler must never read the fields in {@link #forbiddenFields()}. In particular
 * {@code jdk.FileRead} and {@code jdk.FileWrite} carry a {@code path} (it can be world or player-data file names):
 * a handler records only the size, duration or count, and never puts a field value into a metric attribute.
 */
public interface JfrHandler {
    /** Event fields no handler may read or record: file paths, addresses, command lines and stack traces. */
    static Set<String> forbiddenFields() {
        return Set.of("path", "address", "host", "commandLine", "jvmArguments", "javaArguments", "stackTrace");
    }

    /** The JFR event names this handler wants, e.g. {@code jdk.JavaMonitorEnter}. */
    List<String> eventNames();

    /** Called once per recorded event whose name is in {@link #eventNames()} and that the runner enabled. */
    void handle(RecordedEvent event);
}
