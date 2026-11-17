package dev.geldar.ledger.core.census;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Counter;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Census counters: one pair (cancelled false and true) of {@code geldar_event_count_total} series
 * per class of a fixed allow-list. The set of series is fixed at construction; a class name that
 * is not on the list never creates a counter (it is tallied in {@link #unknown()}).
 *
 * <p>The hot path ({@link #count}) is lock-free and allocation-free: one bound counter add per event.
 * There is no local tally; the exported counter is the only record.
 */
public final class CensusCounters {
    private final String[] names;
    private final Map<String, Integer> indexByName;
    private final BoundCounter[] notCancelled;
    private final BoundCounter[] cancelled;
    private final AtomicLong unknown = new AtomicLong();

    /**
     * @param classNames the allow-list of event class names, in index order
     * @throws IllegalArgumentException on a duplicate, null or blank name
     */
    public CensusCounters(Ledger ledger, List<String> classNames) {
        this.names = classNames.toArray(new String[0]);
        this.indexByName = new HashMap<>();
        for (int i = 0; i < names.length; i++) {
            String n = names[i];
            if (n == null || n.isBlank()) {
                throw new IllegalArgumentException("blank census class name at index " + i);
            }
            if (indexByName.put(n, i) != null) {
                throw new IllegalArgumentException("duplicate census class name: " + n);
            }
        }
        Counter counter = ledger.counter(
                Names.Census.EVENT_COUNT_TOTAL,
                "{event}",
                "Server events seen by the census, by event class and cancelled flag",
                AttrKeys.M_EVENT_CLASS,
                AttrKeys.M_CANCELLED);
        this.notCancelled = new BoundCounter[names.length];
        this.cancelled = new BoundCounter[names.length];
        for (int i = 0; i < names.length; i++) {
            notCancelled[i] = counter.bind(names[i], "false");
            cancelled[i] = counter.bind(names[i], "true");
        }
    }

    public int size() {
        return names.length;
    }

    public String className(int index) {
        return names[index];
    }

    /** The index of a class name, or -1 when it is not on the allow-list. Startup use. */
    public int indexOf(String className) {
        Integer i = indexByName.get(className);
        return i == null ? -1 : i;
    }

    /** Counts one event. O(1), allocation-free, any thread. */
    public void count(int index, boolean wasCancelled) {
        (wasCancelled ? cancelled : notCancelled)[index].add(1L);
    }

    /** Counts a class by name; an unknown name creates nothing and is tallied in {@link #unknown()}. */
    public void count(String className, boolean wasCancelled) {
        int i = indexOf(className);
        if (i < 0) {
            unknown.incrementAndGet();
            return;
        }
        count(i, wasCancelled);
    }

    /** Events seen with a name that was not on the allow-list. */
    public long unknown() {
        return unknown.get();
    }
}
