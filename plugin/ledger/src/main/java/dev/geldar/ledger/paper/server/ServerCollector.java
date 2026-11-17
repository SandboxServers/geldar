package dev.geldar.ledger.paper.server;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import java.util.concurrent.atomic.AtomicLongArray;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/**
 * Exports {@code geldar_players_online}, {@code geldar_operators_count}, {@code geldar_plugins_enabled} and
 * {@code geldar_scheduler_pending_tasks}, and emits one {@code geldar.server.config_snapshot} event after enable (PT-05b).
 *
 * <p>The sample runs on the main thread every {@value #SAMPLE_EVERY_TICKS} ticks (once a minute: the pending-task list
 * allocates) inside the collector guard. It keeps counts only: the operator and player lists are never read for names
 * and nothing about who an operator is leaves this class. The gauge readers are field reads. The snapshot is built and
 * emitted on an async timer after {@value #SNAPSHOT_DELAY_MS} ms and the timer is cancelled after its first run.
 */
public final class ServerCollector implements Collector {
    public static final String ID = "server";
    public static final int SAMPLE_EVERY_TICKS = 1200;
    public static final long SNAPSHOT_DELAY_MS = 5000L;

    private static final int PLAYERS = 0;
    private static final int OPERATORS = 1;
    private static final int PLUGINS = 2;
    private static final int PENDING = 3;

    /** The four counts. The live implementation returns sizes only. */
    interface Counts {
        long players();

        long operators();

        long plugins();

        long pendingTasks();
    }

    private static Counts live() {
        return new Counts() {
            @Override
            public long players() {
                return Bukkit.getOnlinePlayers().size();
            }

            @Override
            public long operators() {
                return Bukkit.getOperators().size();
            }

            @Override
            public long plugins() {
                long n = 0;
                for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
                    if (p.isEnabled()) {
                        n++;
                    }
                }
                return n;
            }

            @Override
            public long pendingTasks() {
                return Bukkit.getScheduler().getPendingTasks().size();
            }
        };
    }

    private final Counts counts;
    private final ConfigSnapshot.Source snapshotSource;
    private final AtomicLongArray values = new AtomicLongArray(4);
    private final Object snapshotLock = new Object();
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile Cancellable sampler;
    private volatile Cancellable snapshotTask;
    private volatile boolean running;
    private boolean snapshotDone;

    public ServerCollector() {
        this(live(), ConfigSnapshot.live());
    }

    ServerCollector(Counts counts, ConfigSnapshot.Source snapshotSource) {
        this.counts = counts;
        this.snapshotSource = snapshotSource;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        Ledger l = ctx.ledger();
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        for (int i = 0; i < 4; i++) {
            values.set(i, 0);
        }
        synchronized (snapshotLock) {
            snapshotDone = false;
        }
        running = true;
        l.gaugeLong(Names.Server.PLAYERS_ONLINE, "{player}", "Players online", () -> values.get(PLAYERS));
        l.gaugeLong(Names.Server.OPERATORS_COUNT, "{operator}", "Server operators (count only)", () -> values.get(OPERATORS));
        l.gaugeLong(Names.Server.PLUGINS_ENABLED, "{plugin}", "Enabled plugins", () -> values.get(PLUGINS));
        l.gaugeLong(Names.Server.SCHEDULER_PENDING_TASKS, "{task}", "Pending scheduler tasks", () -> values.get(PENDING));
        sample();
        sampler = ctx.scheduler().everyTicks(SAMPLE_EVERY_TICKS, this::sample);
        snapshotTask = ctx.scheduler().everyMillis(SNAPSHOT_DELAY_MS, this::snapshotOnce);
    }

    @Override
    public void stop() {
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
                values.set(PLUGINS, counts.plugins());
                values.set(PENDING, counts.pendingTasks());
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // a sampling failure never reaches the host (S8)
        }
    }

    /** Async one-shot: emits the snapshot once, then cancels its own timer. Never throws. */
    void snapshotOnce() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
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
            l.events().emitMap(
                    Names.Events.SERVER_CONFIG_SNAPSHOT, Severity.INFO, ConfigSnapshot.build(snapshotSource.raw()));
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }
}
