package dev.geldar.ledger.neoforge.server;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.function.Supplier;

/**
 * {@code geldar_players_online}, {@code geldar_operators_count} and {@code geldar_plugins_enabled} (here: loaded mods),
 * plus one {@code geldar.server.config_snapshot} event shortly after start (Paper parity; there is no
 * scheduler-pending-tasks gauge: NeoForge has no such count). On unless {@code collector.server.enabled=false} or the
 * master is off.
 *
 * <p>The sample runs on the main thread every {@value #SAMPLE_EVERY_TICKS} ticks inside the guard and keeps counts only:
 * no operator or player name is read. The gauge readers are field reads. The snapshot map is read on the main thread at
 * start (the server is not read from another thread); an async one-shot only emits it, and never touches the guard.
 */
public final class ServerCollector implements Collector {
    public static final String ID = "server";
    public static final int SAMPLE_EVERY_TICKS = 1200;
    public static final long SNAPSHOT_DELAY_MS = 5000L;

    private static final int PLAYERS = 0;
    private static final int OPERATORS = 1;
    private static final int MODS = 2;

    /** The three counts: sizes only. Called on the main thread. */
    public interface Counts {
        long players();

        long operators();

        long mods();
    }

    private final Counts counts;
    private final Supplier<Map<String, String>> snapshotSource;
    private final AtomicLongArray values = new AtomicLongArray(3);
    private final Object snapshotLock = new Object();
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile Cancellable sampler;
    private volatile Cancellable snapshotTask;
    private volatile boolean running;
    private volatile Map<String, Object> snapshot;
    private boolean snapshotDone;

    /** {@code snapshotSource} is read once, on the main thread, at start; only allow-listed keys are used. */
    public ServerCollector(Counts counts, Supplier<Map<String, String>> snapshotSource) {
        this.counts = counts;
        this.snapshotSource = snapshotSource;
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
        for (int i = 0; i < values.length(); i++) {
            values.set(i, 0);
        }
        synchronized (snapshotLock) {
            snapshotDone = false;
        }
        snapshot = null;
        running = true;
        l.gaugeLong(Names.Server.PLAYERS_ONLINE, "{player}", "Players online", () -> values.get(PLAYERS));
        l.gaugeLong(Names.Server.OPERATORS_COUNT, "{operator}", "Server operators (count only)", () -> values.get(OPERATORS));
        l.gaugeLong(Names.Server.PLUGINS_ENABLED, "{mod}", "Loaded mods", () -> values.get(MODS));
        sample();
        try {
            snapshot = ConfigSnapshot.build(snapshotSource.get());
        } catch (Throwable t) {
            // no snapshot event
        }
        sampler = ctx.scheduler().everyTicks(SAMPLE_EVERY_TICKS, this::sample);
        snapshotTask = ctx.scheduler().everyMillis(SNAPSHOT_DELAY_MS, this::snapshotOnce);
    }

    @Override
    public synchronized void stop() {
        running = false;
        Cancellable s = sampler;
        Cancellable t = snapshotTask;
        sampler = null;
        snapshotTask = null;
        if (s != null) {
            s.cancel();
        }
        if (t != null) {
            t.cancel();
        }
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
                values.set(PLAYERS, counts.players());
                values.set(OPERATORS, counts.operators());
                values.set(MODS, counts.mods());
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // a sampling failure never reaches the host
        }
    }

    /** Async one-shot: emits the snapshot once, then cancels its own timer. Never throws. */
    void snapshotOnce() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            Map<String, Object> attrs = snapshot;
            if (!running || h == null || l == null || h.isMainThread()) {
                return;
            }
            synchronized (snapshotLock) {
                if (snapshotDone) {
                    return;
                }
                snapshotDone = true;
            }
            Cancellable t = snapshotTask;
            if (t != null) {
                t.cancel();
            }
            if (attrs != null) {
                l.events().emitMap(Names.Events.SERVER_CONFIG_SNAPSHOT, Severity.INFO, attrs);
            }
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }
}