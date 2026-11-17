package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.ArrayList;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * {@code geldar.player.snapshot}: each online agent every 60 s (same event and fields as Paper, minus session and
 * ping). Opt-in, unlike Paper's default: nothing starts unless {@code collector.snapshot.enabled=true} (or Paper's
 * spelling {@code collector.snapshots.enabled=true}) and the master switch is on.
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
    /** Paper's spelling of the same switch; either one opts in. */
    public static final String PAPER_ID = "snapshots";
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

        /** The connection's {@code mc_session}, or null when none is open (read for agents only). */
        default String session() {
            return null;
        }
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

    /**
     * True when the master switch is on and {@code collector.snapshot.enabled} or Paper's spelling
     * {@code collector.snapshots.enabled} is explicitly true. An absent key never opts in.
     */
    public static boolean optedIn(LedgerConfig config) {
        for (String id : new String[] {ID, PAPER_ID}) {
            if (config.collectorEnabled(id) && Boolean.TRUE.equals(config.collectorEnabled().get(id))) {
                return true;
            }
        }
        return false;
    }

    /** The floor of a coordinate, so a negative position rounds down (-0.5 is block -1). */
    public static int blockCoord(double v) {
        return (int) Math.floor(v);
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        if (!optedIn(l.config())) {
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
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            // a sampling failure never reaches the host
        }
    }

    private void capture(Run r) {
        r.run++;
        List<? extends Ref> players = source.get();
        // Pass 1, in roster order so the tracked set is stable: who is an agent, and who is tracked (each counted once).
        Map<String, Long> alive = new LinkedHashMap<>();
        List<Ref> refs = new ArrayList<>();
        for (Ref p : players) {
            String name;
            try {
                name = p.name();
            } catch (Throwable t) {
                if (t instanceof VirtualMachineError vme) {
                    throw vme;
                }
                continue;
            }
            if (!LifeIds.isLifeId(name) || alive.containsKey(name)) {
                continue; // a human is never read further
            }
            Long due = r.due.get(name);
            if (due == null) {
                if (alive.size() >= MAX_TRACKED) {
                    continue; // beyond the cap: not tracked, so never read
                }
                due = r.run;
            }
            alive.put(name, due);
            refs.add(p);
        }
        // Pass 2: read at most MAX_PER_RUN due agents, starting from a rotating cursor.
        int n = refs.size();
        int done = 0;
        List<String> names = new ArrayList<>(alive.keySet());
        for (int k = 0; k < n && done < MAX_PER_RUN; k++) {
            int idx = (r.cursor + k) % n;
            String name = names.get(idx);
            if (r.run < alive.get(name)) {
                continue;
            }
            alive.put(name, r.run + INTERVAL_RUNS); // before the read, so a failing player is not retried every run
            try {
                Reading v = refs.get(idx).read();
                if (v != null && offer(r, name, v, refs.get(idx).session())) {
                    done++;
                }
            } catch (Throwable t) {
                if (t instanceof VirtualMachineError vme) {
                    throw vme;
                }
                // one bad player never stops the others
            }
        }
        r.cursor = n == 0 ? 0 : (r.cursor + MAX_PER_RUN) % n;
        r.due.clear();
        r.due.putAll(alive); // a player who left is forgotten
    }

    private boolean offer(Run r, String lifeId, Reading v, String session) {
        if (r.size.get() >= QUEUE_CAP) {
            r.dropped.incrementAndGet();
            return false;
        }
        r.size.incrementAndGet();
        r.queue.add(attrs(lifeId, v, session));
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
                    if (t instanceof VirtualMachineError vme) {
                        throw vme;
                    }
                    // skip this one
                }
            }
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            // never throws out of the timer
        }
    }

    static Map<String, Object> attrs(String lifeId, Reading v) {
        return attrs(lifeId, v, null);
    }

    /** {@code session} (the join's {@code mc_session}) is exported only when not null or empty. */
    static Map<String, Object> attrs(String lifeId, Reading v, String session) {
        Attrs head = Attrs.of().str(AttrKeys.LIFE_ID, lifeId);
        if (session != null && !session.isEmpty()) {
            head = head.str(AttrKeys.MC_SESSION, session);
        }
        return head
                .str(AttrKeys.WORLD, v.world())
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