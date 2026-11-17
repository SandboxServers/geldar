package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import jdk.jfr.consumer.RecordedEvent;

/**
 * Maps {@code jdk.ThreadCPULoad} (one event per thread per period) to {@code geldar_jfr_thread_group_cpu_ratio{group}}.
 * Thread names are mapped to six fixed groups and never become a label. The ratio of a group is the sum of
 * user+system over its threads in one period; a period ends when an event with a later start time arrives, and the
 * gauge shows the last completed period. Reads only the fields in {@link #FIELDS}.
 *
 * <p>Consequences, both by design: a period is only known to be complete when the next one starts, so every gauge reads
 * 0 until the second period begins; and JFR emits nothing in a period with no load, so if events stop, the gauge keeps
 * showing the last completed period (stale) rather than dropping to 0.
 */
public final class ThreadCpuHandler implements JfrHandler {
    static final String EVENT = "jdk.ThreadCPULoad";
    /** The only event fields this handler reads: the thread's Java name (not an identity) and three numbers. */
    static final Set<String> FIELDS = Set.of("startTime", "user", "system", "eventThread.javaName");

    static final List<String> GROUPS = List.of("server", "io", "ledger", "jit", "gc", "other");

    private final Map<String, Double> pending = new LinkedHashMap<>();
    private final Map<String, Double> published = new LinkedHashMap<>();
    private Instant window;

    private final List<String> ioPrefixes;

    public ThreadCpuHandler(Ledger ledger) {
        this(ledger, JfrSettings.DEFAULT_IO_THREAD_PREFIXES);
    }

    public ThreadCpuHandler(Ledger ledger, List<String> ioThreadPrefixes) {
        this.ioPrefixes = List.copyOf(ioThreadPrefixes);
        for (String g : GROUPS) {
            pending.put(g, 0.0);
            published.put(g, 0.0);
            ledger.gaugeDouble(
                    Names.Jfr.THREAD_GROUP_CPU_RATIO,
                    "1",
                    "CPU ratio (user+system) of a thread group over the last JFR period",
                    () -> read(g),
                    "group",
                    g);
        }
    }

    /** The group of a thread name; null and unknown names are {@code other}. */
    static String groupOf(String threadName) {
        return groupOf(threadName, JfrSettings.DEFAULT_IO_THREAD_PREFIXES);
    }

    static String groupOf(String threadName, List<String> ioPrefixes) {
        if (threadName == null) {
            return "other";
        }
        if (threadName.equals("Server thread")) {
            return "server";
        }
        if (threadName.startsWith("ledger-")) {
            return "ledger";
        }
        if (ioPrefixes.stream().anyMatch(threadName::startsWith)) {
            return "io";
        }
        if (threadName.startsWith("C2 CompilerThread") || threadName.startsWith("C1 CompilerThread")) {
            return "jit";
        }
        if (threadName.startsWith("G1") || threadName.startsWith("GC")) {
            return "gc";
        }
        return "other";
    }

    private synchronized double read(String group) {
        return published.get(group);
    }

    @Override
    public List<String> eventNames() {
        return List.of(EVENT);
    }

    @Override
    public void handle(RecordedEvent event) {
        handle(event.getEventType().getName(), f -> event.getValue(f));
    }

    /** The seam: the event name and an accessor for the fields in {@link #FIELDS}. */
    synchronized void handle(String eventName, Function<String, Object> field) {
        if (!EVENT.equals(eventName)) {
            return;
        }
        Instant start = (Instant) field.apply("startTime");
        double ratio = number(field.apply("user")) + number(field.apply("system"));
        String group = groupOf((String) field.apply("eventThread.javaName"), ioPrefixes);
        if (window != null && start != null && start.isAfter(window)) {
            published.putAll(pending);
            pending.replaceAll((k, v) -> 0.0);
        }
        if (start != null) {
            window = start;
        }
        pending.merge(group, ratio, Double::sum);
    }

    private static double number(Object o) {
        return o instanceof Number n ? n.doubleValue() : 0.0;
    }
}
