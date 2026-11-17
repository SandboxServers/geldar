package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Counter;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import jdk.jfr.consumer.RecordedEvent;

/**
 * Counts {@code jdk.JavaMonitorEnter} (threshold 20 ms) in {@code geldar_jfr_monitor_contention_total{class_group}}.
 * The group is the first two package segments of the monitor's class ({@code org.bukkit.craftbukkit.X} becomes
 * {@code org.bukkit}). At most {@link #MAX_GROUPS} distinct groups are kept; further ones count as {@code other}.
 * Reads only the class name, never the thread, the address or the stack.
 */
public final class ContentionHandler implements JfrHandler {
    static final String EVENT = "jdk.JavaMonitorEnter";
    static final Set<String> FIELDS = Set.of("monitorClass.name");
    static final int MAX_GROUPS = 32;
    static final String OTHER = "other";

    private final Counter counter;
    private final Map<String, BoundCounter> bound = new ConcurrentHashMap<>();

    public ContentionHandler(Ledger ledger) {
        this.counter = ledger.counter(
                Names.Jfr.MONITOR_CONTENTION_TOTAL,
                "1",
                "Monitor enters that blocked past the JFR threshold",
                "class_group");
        bound.put(OTHER, counter.bind(OTHER));
    }

    /** First two package segments; a class without a package is {@code default}; null is {@code other}. */
    static String groupOf(String className) {
        if (className == null || className.isEmpty()) {
            return OTHER;
        }
        String n = className.startsWith("[") ? className.replaceAll("^\\[+L?", "") : className;
        String[] parts = n.split("\\.");
        if (parts.length < 2) {
            return "default";
        }
        return parts.length == 2 && !parts[0].isEmpty() ? parts[0] : parts[0] + "." + parts[1];
    }

    @Override
    public List<String> eventNames() {
        return List.of(EVENT);
    }

    @Override
    public void handle(RecordedEvent event) {
        handle(event.getEventType().getName(), f -> event.getValue(f));
    }

    void handle(String eventName, Function<String, Object> field) {
        if (!EVENT.equals(eventName)) {
            return;
        }
        String group = groupOf((String) field.apply("monitorClass.name"));
        BoundCounter c = bound.get(group);
        if (c == null) {
            synchronized (bound) {
                c = bound.get(group);
                if (c == null) {
                    c = bound.size() > MAX_GROUPS ? bound.get(OTHER) : bind(group);
                }
            }
        }
        c.add(1);
    }

    private BoundCounter bind(String group) {
        BoundCounter c = counter.bind(group);
        bound.put(group, c);
        return c;
    }
}
