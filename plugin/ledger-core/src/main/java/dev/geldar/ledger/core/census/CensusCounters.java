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
import java.util.concurrent.atomic.AtomicLongArray;

/**
 * Census counters: one pair (cancelled false and true) of {@code geldar_event_count_total} series
 * per class of a fixed allow-list. The set of series is fixed at construction; a class name that
 * is not on the list never creates a counter (it is tallied in {@link #unknown()}).
 *
 * <p>The hot path ({@link #count}, {@link #add}) is lock-free and allocation-free. Each count also
 * lands in a local saturating tally so a collector can {@link #snapshot()} and
 * {@link #snapshotAndReset()} it; the exported counter is never reset.
 */
public final class CensusCounters {
    private final String[] names;
    private final Map<String, Integer> indexByName;
    private final BoundCounter[] notCancelled;
    private final BoundCounter[] cancelled;
    private final AtomicLongArray tally; // [2 * i] not cancelled, [2 * i + 1] cancelled
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
                AttrKeys.EVENT_CLASS,
                AttrKeys.CANCELLED);
        this.notCancelled = new BoundCounter[names.length];
        this.cancelled = new BoundCounter[names.length];
        for (int i = 0; i < names.length; i++) {
            notCancelled[i] = counter.bind(names[i], "false");
            cancelled[i] = counter.bind(names[i], "true");
        }
        this.tally = new AtomicLongArray(2 * names.length);
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
        add(index, wasCancelled, 1L);
    }

    /** Counts a class by name; an unknown name creates nothing and is tallied in {@link #unknown()}. */
    public void count(String className, boolean wasCancelled) {
        int i = indexOf(className);
        if (i < 0) {
            unknown.incrementAndGet();
            return;
        }
        add(i, wasCancelled, 1L);
    }

    /** Adds {@code n} (ignored when not positive). The local tally saturates at Long.MAX_VALUE. */
    public void add(int index, boolean wasCancelled, long n) {
        if (n <= 0) {
            return;
        }
        (wasCancelled ? cancelled : notCancelled)[index].add(n);
        int slot = 2 * index + (wasCancelled ? 1 : 0);
        long cur;
        long next;
        do {
            cur = tally.get(slot);
            next = cur + n;
            if (next < cur) {
                next = Long.MAX_VALUE;
            }
        } while (cur != next && !tally.compareAndSet(slot, cur, next));
    }

    /** Events seen with a name that was not on the allow-list. */
    public long unknown() {
        return unknown.get();
    }

    /** Tally of one series since the last reset. */
    public long tally(int index, boolean wasCancelled) {
        return tally.get(2 * index + (wasCancelled ? 1 : 0));
    }

    /** A copy of all tallies, laid out {@code [2 * i]} not cancelled, {@code [2 * i + 1]} cancelled. */
    public long[] snapshot() {
        long[] out = new long[tally.length()];
        for (int i = 0; i < out.length; i++) {
            out[i] = tally.get(i);
        }
        return out;
    }

    /** Like {@link #snapshot()} but each slot is read and zeroed atomically, so no count is lost. */
    public long[] snapshotAndReset() {
        long[] out = new long[tally.length()];
        for (int i = 0; i < out.length; i++) {
            out[i] = tally.getAndSet(i, 0L);
        }
        return out;
    }
}
