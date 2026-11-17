package dev.geldar.ledger.paper.world;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.World;

/**
 * Exports {@code geldar_world_loaded_chunks}, {@code geldar_world_entities} and {@code geldar_world_players} per world.
 *
 * <p>The sample runs on the main thread every {@code sample.world_every_ticks}. It reads only the three counts of a world
 * ({@code getChunkCount}, {@code getEntityCount}, {@code getPlayerCount}): never the loaded chunk, entity or player lists,
 * and never a chunk by coordinates (S11). At most {@value #WORLDS_PER_RUN} worlds are read per run, from a rotating
 * cursor, and at most {@value #MAX_WORLDS} worlds are ever tracked, so cardinality and per-tick work are bounded. The
 * gauge readers are field reads. Gauge registration is not allowed on the main thread, so a small async timer registers
 * the series of a world the sample has newly seen (a world added at run time appears without a restart).
 */
public final class WorldCollector implements Collector {
    public static final String ID = "world";
    /** Cap on tracked worlds (metric cardinality). */
    public static final int MAX_WORLDS = 16;
    /** Worlds read in one sampling run: the per-tick work bound. */
    public static final int WORLDS_PER_RUN = 8;
    /**
     * Cap on gauge series registered over the collector's life. Gauges cannot be unregistered and their world attribute is
     * fixed at registration, so a world that unloads keeps its three series (reading 0) and a new name needs new series.
     * At most {@value #MAX_WORLDS} worlds are live at once; this bounds the churn (temporary worlds) to
     * {@value #MAX_SERIES_WORLDS} distinct names per collector start.
     */
    public static final int MAX_SERIES_WORLDS = 4 * MAX_WORLDS;

    static final long REGISTER_EVERY_MS = 1000L;

    private static final int CHUNKS = 0;
    private static final int ENTITIES = 1;
    private static final int PLAYERS = 2;

    private final Supplier<List<? extends World>> source;
    /** Live worlds: at most MAX_WORLDS. */
    private final Map<String, AtomicLongArray> values = new ConcurrentHashMap<>();
    /** Every name that ever got series (live or stale): at most MAX_SERIES_WORLDS. A stale world's array reads 0. */
    private final Map<String, AtomicLongArray> series = new ConcurrentHashMap<>();
    private final Set<String> registered = new HashSet<>();
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile Cancellable sampler;
    private volatile Cancellable registrar;
    private volatile boolean running;
    private int cursor;

    public WorldCollector() {
        this(Bukkit::getWorlds);
    }

    WorldCollector(Supplier<List<? extends World>> source) {
        this.source = source;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        ledger = ctx.ledger();
        host = ctx.host();
        guard = ledger.guard(ID);
        synchronized (registered) {
            registered.clear();
        }
        values.clear();
        series.clear();
        cursor = 0;
        running = true;
        int every = Math.max(1, ledger.config().sampleWorldEveryTicks());
        sampler = ctx.scheduler().everyTicks(every, this::sample);
        registrar = ctx.scheduler().everyMillis(REGISTER_EVERY_MS, this::registerNew);
    }

    @Override
    public void stop() {
        running = false;
        Cancellable s = sampler;
        Cancellable r = registrar;
        sampler = null;
        registrar = null;
        if (s != null) {
            s.cancel();
        }
        if (r != null) {
            r.cancel();
        }
    }

    /** Names of the worlds that have a sampled value (read by tests). */
    java.util.List<String> trackedWorlds() {
        return new ArrayList<>(values.keySet());
    }

    /** One main-thread run. Never throws; does nothing off the main thread or once the guard switched the collector off. */
    void sample() {
        try {
            HostInfo h = host;
            CollectorGuard g = guard;
            if (!running || h == null || g == null || !h.isMainThread() || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                readSlice();
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // a sampling failure never reaches the host (S8)
        }
    }

    private void readSlice() {
        List<? extends World> worlds = source.get();
        dropUnloaded(worlds);
        int total = Math.min(worlds.size(), MAX_WORLDS);
        if (total == 0) {
            return;
        }
        if (cursor >= total) {
            cursor = 0;
        }
        int n = Math.min(total, WORLDS_PER_RUN);
        for (int i = 0; i < n; i++) {
            World w = worlds.get(cursor);
            cursor = (cursor + 1) % total;
            String name = w.getName();
            if (name == null || name.isEmpty() || name.length() > 64) {
                continue;
            }
            AtomicLongArray v = values.get(name);
            if (v == null) {
                if (values.size() >= MAX_WORLDS) {
                    continue;
                }
                v = series.get(name); // a world that comes back reuses its registered series
                if (v == null) {
                    if (series.size() >= MAX_SERIES_WORLDS) {
                        continue;
                    }
                    v = new AtomicLongArray(3);
                    series.put(name, v);
                }
                values.put(name, v);
            }
            v.set(CHUNKS, w.getChunkCount());
            v.set(ENTITIES, w.getEntityCount());
            v.set(PLAYERS, w.getPlayerCount());
        }
    }

    /** A live world that is no longer loaded frees its slot; its (unremovable) gauges read 0 from now on. */
    private void dropUnloaded(List<? extends World> worlds) {
        for (Map.Entry<String, AtomicLongArray> e : values.entrySet()) {
            boolean loaded = false;
            for (World w : worlds) {
                if (e.getKey().equals(w.getName())) {
                    loaded = true;
                    break;
                }
            }
            if (!loaded) {
                AtomicLongArray v = e.getValue();
                for (int i = 0; i < 3; i++) {
                    v.set(i, 0);
                }
                values.remove(e.getKey());
            }
        }
    }

    /** Async timer: registers the three gauges of each world the sample has seen and not registered yet. */
    void registerNew() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            if (!running || h == null || l == null || h.isMainThread()) {
                return;
            }
            for (Map.Entry<String, AtomicLongArray> e : series.entrySet()) {
                String world = e.getKey();
                synchronized (registered) {
                    if (!registered.add(world)) {
                        continue;
                    }
                }
                AtomicLongArray v = e.getValue();
                String key = AttrKeys.M_WORLD;
                l.gaugeLong(Names.World.LOADED_CHUNKS, "{chunk}", "Loaded chunks in a world", () -> v.get(CHUNKS), key, world);
                l.gaugeLong(Names.World.ENTITIES, "{entity}", "Entities in a world", () -> v.get(ENTITIES), key, world);
                l.gaugeLong(Names.World.PLAYERS, "{player}", "Players in a world", () -> v.get(PLAYERS), key, world);
            }
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }
}
