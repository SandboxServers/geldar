package dev.geldar.ledger.paper.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/**
 * {@code geldar.player.snapshot}: each online agent every 60 s (PT-08b).
 *
 * <p>Identity. Only a player whose login name has the life id shape is exported, keyed by that {@code life_id} and the
 * join's {@code mc_session} (from {@link SessionIds#shared()}, empty and not exported when the session is not known).
 * A human is never exported (not even counted per player): the name is read once to classify and then dropped. Never read:
 * UUID (a map key only), address, display name, inventory, held item, effects. Ping is exported as a bucket, health
 * rounded to a tenth, position as block coordinates.
 *
 * <p>Threading. {@link #run} runs on the main thread every tick, inside the guard, and only copies primitives and existing
 * strings into a preallocated ring: at most {@value #MAX_PER_RUN} players per run, at most {@value #EXAMINE_PER_RUN}
 * roster entries looked at per run (a rotating cursor), and it stops once {@value #BUDGET_NANOS} ns have been used. The
 * roster is re-read once per {@value #REFRESH_TICKS} ticks. An async task drains the ring and calls {@code emitMap}.
 * A full ring drops the snapshot.
 */
public final class SnapshotCollector implements Collector {
    public static final String ID = "snapshots";
    public static final int INTERVAL_TICKS = 1200;
    public static final int REFRESH_TICKS = 20;
    public static final int MAX_PER_RUN = 2;
    public static final int EXAMINE_PER_RUN = 64;
    public static final int MAX_TRACKED = 512;
    public static final long BUDGET_NANOS = 50_000L;
    static final int RING = 64;
    static final long DRAIN_MS = 1000L;

    /** One captured snapshot: primitives and strings that already exist. */
    static final class Slot {
        String lifeId;
        String session;
        String world;
        String gamemode;
        int x;
        int y;
        int z;
        double health;
        int food;
        int xpLevel;
        long pingBucket;
    }

    private static final class Entry {
        long due;
        int gen;
    }

    private final Supplier<Collection<? extends Player>> source;
    private final LongSupplier nanos;
    private final SessionIds sessions;
    private final Slot[] ring = new Slot[RING];
    private volatile long head;
    private volatile long tail;

    // main-thread state
    private final Player[] roster = new Player[MAX_TRACKED];
    private final Entry[] rosterEntries = new Entry[MAX_TRACKED];
    private final Map<UUID, Entry> entries = new HashMap<>();
    private int rosterSize;
    private int cursor;
    private int gen;
    private long tick;
    private long lastRefresh;

    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile Cancellable sampler;
    private volatile Cancellable drainer;
    private volatile boolean running;
    private volatile long dropped;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public SnapshotCollector() {
        this(Bukkit::getOnlinePlayers, System::nanoTime, SessionIds.shared());
    }

    SnapshotCollector(Supplier<Collection<? extends Player>> source, LongSupplier nanos, SessionIds sessions) {
        this.source = source;
        this.nanos = nanos;
        this.sessions = sessions;
        for (int i = 0; i < RING; i++) {
            ring[i] = new Slot();
        }
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        if (!l.config().collectorEnabled(ID)) {
            return;
        }
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        resetState();
        running = true;
        sampler = ctx.scheduler().everyTicks(1, this::run);
        drainer = ctx.scheduler().everyMillis(DRAIN_MS, this::drain);
    }

    @Override
    public synchronized void stop() {
        running = false;
        Cancellable s = sampler;
        Cancellable d = drainer;
        sampler = null;
        drainer = null;
        if (s != null) {
            s.cancel();
        }
        if (d != null) {
            d.cancel();
        }
    }

    private void resetState() {
        entries.clear();
        for (int i = 0; i < MAX_TRACKED; i++) {
            roster[i] = null;
            rosterEntries[i] = null;
        }
        rosterSize = 0;
        cursor = 0;
        tick = 0;
        lastRefresh = Long.MIN_VALUE / 2;
        head = tail;
    }

    SessionIds sessions() {
        return sessions;
    }

    /** Snapshots dropped because the ring was full (read by tests). */
    long dropped() {
        return dropped;
    }

    /** One main-thread run. Never throws; does nothing off the main thread or once the guard switched the collector off. */
    void run() {
        try {
            HostInfo h = host;
            CollectorGuard g = guard;
            if (!running || h == null || g == null || !h.isMainThread() || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                tick++;
                if (tick - lastRefresh >= REFRESH_TICKS) {
                    lastRefresh = tick;
                    refresh();
                }
                capturePending();
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // a sampling failure never reaches the host (S8)
        }
    }

    /** Re-reads the online roster into the preallocated arrays; a new player is due at once, a gone one is forgotten. */
    private void refresh() {
        gen++;
        int n = 0;
        for (Player p : source.get()) {
            if (n >= MAX_TRACKED) {
                break;
            }
            try {
                UUID id = p.getUniqueId();
                Entry e = entries.get(id);
                if (e == null) {
                    e = new Entry();
                    e.due = tick;
                    entries.put(id, e);
                }
                e.gen = gen;
                roster[n] = p;
                rosterEntries[n] = e;
                n++;
            } catch (Throwable t) {
                // a bad player is left out of this roster
            }
        }
        for (int i = n; i < rosterSize; i++) {
            roster[i] = null;
            rosterEntries[i] = null;
        }
        rosterSize = n;
        for (Iterator<Entry> it = entries.values().iterator(); it.hasNext(); ) {
            if (it.next().gen != gen) {
                it.remove();
            }
        }
    }

    private void capturePending() {
        int n = rosterSize;
        if (n == 0) {
            return;
        }
        if (cursor >= n) {
            cursor = 0;
        }
        long start = nanos.getAsLong();
        int done = 0;
        int examined = Math.min(n, EXAMINE_PER_RUN);
        for (int i = 0; i < examined && done < MAX_PER_RUN; i++) {
            int idx = cursor;
            cursor = (cursor + 1) % n;
            Entry e = rosterEntries[idx];
            if (e == null || tick < e.due) {
                continue;
            }
            e.due = tick + INTERVAL_TICKS; // before the read, so a failing player is not retried every tick
            try {
                if (capture(roster[idx])) {
                    done++;
                }
            } catch (Throwable t) {
                // one bad player never stops the others
            }
            if (nanos.getAsLong() - start >= BUDGET_NANOS) {
                break;
            }
        }
    }

    /** Reads one player into the next ring slot. False when the player is a human or the ring is full. */
    private boolean capture(Player p) {
        String name = p.getName();
        if (!LifeIds.isLifeId(name)) {
            return false;
        }
        long t = tail;
        if (t - head >= RING) {
            dropped++;
            return false;
        }
        Slot s = ring[(int) (t % RING)];
        s.lifeId = name;
        s.session = sessions.get(p.getUniqueId());
        s.world = p.getWorld().getName();
        s.x = blockOf(p.getX());
        s.y = blockOf(p.getY());
        s.z = blockOf(p.getZ());
        s.health = roundHealth(p.getHealth());
        s.food = p.getFoodLevel();
        s.xpLevel = p.getLevel();
        s.gamemode = p.getGameMode().name();
        s.pingBucket = pingBucket(p.getPing());
        tail = t + 1;
        return true;
    }

    /** Async task: turns the captured slots into events. Never on the main thread. */
    void drain() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            if (!running || h == null || l == null || h.isMainThread()) {
                return;
            }
            long hd = head;
            long tl = tail;
            while (hd < tl) {
                Slot s = ring[(int) (hd % RING)];
                try {
                    l.events().emitMap(Names.Events.PLAYER_SNAPSHOT, Severity.INFO, attrs(s));
                } catch (Throwable t) {
                    // skip this slot
                }
                hd++;
                head = hd;
            }
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }

    static Map<String, Object> attrs(Slot s) {
        Attrs a = Attrs.of()
                .str(AttrKeys.LIFE_ID, s.lifeId)
                .str(AttrKeys.WORLD, s.world)
                .lng(AttrKeys.X, s.x)
                .lng(AttrKeys.Y, s.y)
                .lng(AttrKeys.Z, s.z)
                .dbl(AttrKeys.HEALTH, s.health)
                .lng(AttrKeys.FOOD, s.food)
                .lng(AttrKeys.XP_LEVEL, s.xpLevel)
                .str(AttrKeys.GAMEMODE, s.gamemode)
                .lng(AttrKeys.PING_BUCKET, s.pingBucket);
        if (s.session != null && !s.session.isEmpty()) {
            a = a.str(AttrKeys.MC_SESSION, s.session);
        }
        return a.build();
    }

    /** The block coordinate of a position (floor, so negatives round down). */
    static int blockOf(double v) {
        return (int) Math.floor(v);
    }

    /** Health rounded to a tenth. */
    static double roundHealth(double h) {
        return Math.round(h * 10.0) / 10.0;
    }

    /** Ping as the upper bound of its bucket: 50, 100, 200, 500, 1000 ms; -1 when unknown (negative). */
    static long pingBucket(int ms) {
        if (ms < 0) {
            return -1;
        }
        if (ms <= 50) {
            return 50;
        }
        if (ms <= 100) {
            return 100;
        }
        if (ms <= 200) {
            return 200;
        }
        return ms <= 500 ? 500 : 1000;
    }
}
