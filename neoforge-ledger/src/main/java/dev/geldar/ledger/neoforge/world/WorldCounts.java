package dev.geldar.ledger.neoforge.world;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLongArray;

/**
 * Running chunk, entity and player counts per dimension, fed by the load, unload, join and leave events (the server has
 * no total-count accessor we could verify). Events arrive on the main thread; gauge readers read the atomics. At most
 * {@value #MAX_WORLDS} names are ever tracked and a name longer than {@value #MAX_NAME} characters is ignored, so the
 * metric cardinality is bounded whatever the events carry.
 */
public final class WorldCounts {
    public static final int MAX_WORLDS = 16;
    public static final int MAX_NAME = 64;
    public static final int CHUNKS = 0;
    public static final int ENTITIES = 1;
    public static final int PLAYERS = 2;

    private final Map<String, AtomicLongArray> dims = new ConcurrentHashMap<>();

    /** The array of a dimension, created on first sight; null for a bad name or once the cap is reached. */
    private AtomicLongArray of(String dim) {
        if (dim == null || dim.isEmpty() || dim.length() > MAX_NAME) {
            return null;
        }
        AtomicLongArray a = dims.get(dim);
        if (a == null) {
            if (dims.size() >= MAX_WORLDS) {
                return null;
            }
            a = dims.computeIfAbsent(dim, k -> new AtomicLongArray(3));
        }
        return a;
    }

    /** Starts tracking a dimension (reads 0 until an event arrives). */
    public boolean track(String dim) {
        return of(dim) != null;
    }

    public void chunk(String dim, int delta) {
        add(dim, CHUNKS, delta);
    }

    public void entity(String dim, boolean player, int delta) {
        add(dim, ENTITIES, delta);
        if (player) {
            add(dim, PLAYERS, delta);
        }
    }

    private void add(String dim, int slot, int delta) {
        AtomicLongArray a = of(dim);
        if (a != null) {
            a.updateAndGet(slot, v -> Math.max(0, v + delta));
        }
    }

    public List<String> names() {
        return List.copyOf(dims.keySet());
    }

    public long get(String dim, int slot) {
        AtomicLongArray a = dims.get(dim);
        return a == null ? 0 : a.get(slot);
    }

    /** Reader for a gauge; fixed array, a field read. */
    public java.util.function.LongSupplier reader(String dim, int slot) {
        AtomicLongArray a = dims.get(dim);
        return () -> a.get(slot);
    }
}