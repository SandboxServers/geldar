package dev.geldar.ledger.neoforge.players;

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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * {@code geldar.player.snapshot}: each online agent every 60 s (Paper parity). Opt-in: nothing starts unless
 * {@code collector.snapshot.enabled=true} (the default is off) and the master switch is on.
 *
 * <p>Identity. Only a player whose login name has the life id shape is exported, keyed by that {@code life_id}. A human
 * is never exported: the name is read to classify and no other field of that player is read. No UUID, address, display
 * name, inventory or ping is read or exported (there is no {@code mc_session} until the connection collector exists).
 *
 * <p>Threading. {@link #run} runs on the main thread every {@value #RUN_TICKS} ticks inside the guard and reads at most
 * {@value #MAX_PER_RUN} agents; due times are tracked per life id (at most {@value #MAX_TRACKED}). Captured values go
 * into a bounded queue owned by one {@code Run}; an async task drains it and calls {@code emitMap} and never touches the
 * guard. A restart makes a new {@code Run}: a task of the old run sees its own closed flag and queue, never the new
 * run's, so a stop or restart cannot lose or double-emit the new run's snapshots.
 */
public final class SnapshotCollector implements Collector {
    public static final String ID = "snapshot";
    public static final int RUN_TICKS = 20;
    /** 60 s between snapshots of one agent. */
    public static final int INTERVAL_RUNS = 60;
    public static final int MAX_PER_RUN = 8;
    public static final int MAX_TRACKED = 512;
    static final int QUEUE_CAP = 64;
    static final long DRAIN_MS = 1000L;

    /** One online player as the wiring sees it: the name first, the other fields only for an agent. */
    public interface Ref {
        String name();

        Reading read();
    }

    /** The fields of one snapshot; plain values, copied on the main thread. */
    public record Reading(
            String world, int x, int y, int z, double health, int food, int xpLevel, String gamemode) {}

    private static final class Run {
        final Queue<Map<String, Object>> queue = new ConcurrentLinkedQueue<>();
        final AtomicInteger size = new AtomicInteger();
        final AtomicInteger dropped = new AtomicInteger();
        final Map<String, Long> due = new HashMap<>(); // main thread only
        volatile boolean closed;
        long run;
        int cursor;
    }

    private final Supplier<List<? extends Ref>> source;
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile Cancellable sampler;
    private volatile Cancellable drainer;
    private volatile Run current;

    public SnapshotCollector(Supplier<List<? extends Ref>> source) {
        this.source = source;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        if (!l.config().collectorEnabled(ID) || !Boolean.TRUE.equals(l.config().collectorEnabled().get(ID))) {
            return; // opt-in: only an explicit true starts it
        }
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        Run r = new Run();
        current = r;
        sampler = ctx.scheduler().everyTicks(RUN_TICKS, () -> run(r));
        drainer = ctx.scheduler().everyMillis(DRAIN_MS, () -> drain(r));
    }

    @Override
    public synchronized void stop() {
        Run r = current;
        current = null;
        if (r != null) {
            r.closed = true;
        }
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

    /** Snapshots dropped because the queue was full, for the current run (read by tests). */
    public int dropped() {
        Run r = current;
        return r == null ? 0 : r.dropped.get();
    }

    /** The main-thread run of the current collector start (read by tests). */
    void runNow() {
        Run r = current;
        if (r != null) {
            run(r);
        }
    }

    void drainNow() {
        Run r = current;
        if (r != null) {
            drain(r);
        }
    }

    /** One main-thread run. Never throws; does nothing off the main thread or once the guard switched it off. */
    private void run(Run r) {
        try {
            HostInfo h = host;
            CollectorGuard g = guard;
            if (r.closed || h == null || g == null || !h.isMainThread() || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                capture(r);
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // a sampling failure never reaches the host
        }
    }

    private void capture(Run r) {
        r.run++;
        List<? extends Ref> players = source.get();
        int n = players.size();
        Map<String, Long> alive = new HashMap<>();
        int done = 0;
        for (int k = 0; k < n; k++) {
            int idx = (r.cursor + k) % n;
            Ref p = players.get(idx);
            String name;
            try {
                name = p.name();
            } catch (Throwable t) {
                continue;
            }
            if (!LifeIds.isLifeId(name)) {
                continue; // a human: never read further
            }
            Long due = r.due.get(name);
            if (due == null) {
                if (r.due.size() + alive.size() >= MAX_TRACKED) {
                    continue;
                }
                due = r.run;
            }
            if (r.run < due || done >= MAX_PER_RUN) {
                alive.put(name, due);
                continue;
            }
            alive.put(name, r.run + INTERVAL_RUNS); // before the read, so a failing player is not retried every run
            try {
                Reading v = p.read();
                if (v != null && offer(r, name, v)) {
                    done++;
                }
            } catch (Throwable t) {
                // one bad player never stops the others
            }
        }
        r.cursor = n == 0 ? 0 : (r.cursor + MAX_PER_RUN) % n;
        r.due.clear();
        r.due.putAll(alive); // a player who left is forgotten
    }

    private boolean offer(Run r, String lifeId, Reading v) {
        if (r.size.get() >= QUEUE_CAP) {
            r.dropped.incrementAndGet();
            return false;
        }
        r.size.incrementAndGet();
        r.queue.add(attrs(lifeId, v));
        return true;
    }

    /** Async task: emits the queued snapshots of its own run. Never on the main thread, never the guard. */
    private void drain(Run r) {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            if (r.closed || h == null || l == null || h.isMainThread()) {
                return;
            }
            Map<String, Object> a;
            while (!r.closed && (a = r.queue.poll()) != null) {
                r.size.decrementAndGet();
                try {
                    l.events().emitMap(Names.Events.PLAYER_SNAPSHOT, Severity.INFO, a);
                } catch (Throwable t) {
                    // skip this one
                }
            }
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }

    static Map<String, Object> attrs(String lifeId, Reading v) {
        return Attrs.of()
                .str(AttrKeys.LIFE_ID, lifeId)
                .str(AttrKeys.WORLD, v.world())
                .lng(AttrKeys.X, v.x())
                .lng(AttrKeys.Y, v.y())
                .lng(AttrKeys.Z, v.z())
                .dbl(AttrKeys.HEALTH, Math.round(v.health() * 10.0) / 10.0)
                .lng(AttrKeys.FOOD, v.food())
                .lng(AttrKeys.XP_LEVEL, v.xpLevel())
                .str(AttrKeys.GAMEMODE, v.gamemode())
                .build();
    }
}