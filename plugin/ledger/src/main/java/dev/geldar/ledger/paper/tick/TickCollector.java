package dev.geldar.ledger.paper.tick;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.tick.StallDetector;
import dev.geldar.ledger.core.tick.TickStats;
import dev.geldar.ledger.paper.LedgerPlugin;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.ServerTickManager;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Tick lag, overruns, stalls, TPS and the tick manager's rate and frozen flag (PT-04b). The tick manager is read
 * through getters only; no setter is ever called (S11).
 */
public final class TickCollector implements Collector {
    public static final String ID = "tick";
    public static final int MANAGER_EVERY_TICKS = 100;
    public static final long STALL_CHECK_MS = 500;
    private static final int SLOW_TICK_RATE_PER_SECOND = 5;

    private final Consumer<Listener> registry;
    private final Supplier<ServerTickManager> manager;
    private final Supplier<double[]> tps;
    private final LongSupplier nanoClock;

    private volatile double rateTarget = 20.0;
    private volatile long frozen;
    /** Watchdog thread only: a stall was detected while the guard was off, so its recovery record is dropped. */
    private volatile boolean suppressRecovery;
    private TickEndListener listener;
    private TpsGauges tpsGauges;
    private Cancellable managerTask;
    private StallWatchdog watchdog;
    private final StallWatchdog.Sleeper sleeper;

    /** Production constructor, used by reflection from the collector factory. */
    public TickCollector() {
        this(
                l -> JavaPlugin.getPlugin(LedgerPlugin.class).listeners().register(l),
                Bukkit::getServerTickManager,
                Bukkit::getTPS,
                System::nanoTime);
    }

    TickCollector(
            Consumer<Listener> registry,
            Supplier<ServerTickManager> manager,
            Supplier<double[]> tps,
            LongSupplier nanoClock) {
        this(registry, manager, tps, nanoClock, Thread::sleep);
    }

    TickCollector(
            Consumer<Listener> registry,
            Supplier<ServerTickManager> manager,
            Supplier<double[]> tps,
            LongSupplier nanoClock,
            StallWatchdog.Sleeper sleeper) {
        this.registry = registry;
        this.manager = manager;
        this.tps = tps;
        this.nanoClock = nanoClock;
        this.sleeper = sleeper;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        suppressRecovery = false;
        Ledger l = ctx.ledger();
        CollectorGuard guard = l.guard(ID);
        long thresholdMs = l.config().stallThresholdMs();
        TickStats stats = new TickStats();
        StallDetector stall = new StallDetector(thresholdMs, nanoClock);
        BoundCounter stalls = l.counter(Names.Tick.STALLS_TOTAL, "1", "main thread stalls").bind();
        int slowId = l.events()
                .register(
                        Names.Events.SERVER_SLOW_TICK,
                        Severity.WARN,
                        SLOW_TICK_RATE_PER_SECOND,
                        AttrKeys.SERVER_TICK,
                        AttrKeys.DURATION_MS,
                        AttrKeys.TICK_OVERRUNS,
                        AttrKeys.WORLD);
        listener = new TickEndListener(
                l.histogram(Names.Tick.LAG_MS, "ms", "tick duration", TickStats.BOUNDS).bind(),
                l.counter(Names.Tick.OVERRUNS_TOTAL, "1", "ticks over 50 ms").bind(),
                stats,
                stall,
                guard,
                l.events(),
                slowId);
        registry.accept(listener);

        tpsGauges = new TpsGauges(tps);
        tpsGauges.start(l, ctx.scheduler());

        l.gaugeDouble(Names.Tick.RATE_TARGET, "1", "tick rate target", () -> rateTarget);
        l.gaugeLong(Names.Tick.FROZEN, "1", "1 when the tick manager is frozen", () -> frozen);
        sampleManager(guard);
        managerTask = ctx.scheduler().everyTicks(MANAGER_EVERY_TICKS, () -> sampleManager(guard));

        // Not the host scheduler: Bukkit dispatches async timers from the main thread, which is what hangs.
        watchdog = new StallWatchdog(
                STALL_CHECK_MS, sleeper, () -> checkStall(stall, stalls, guard, l, ctx, thresholdMs));
        watchdog.start();
    }

    /** Main thread: getters only. */
    private void sampleManager(CollectorGuard guard) {
        try {
            if (!guard.allowed()) {
                return;
            }
            long token = guard.begin();
            try {
                ServerTickManager m = manager.get();
                rateTarget = m.getTickRate();
                frozen = m.isFrozen() ? 1 : 0;
            } finally {
                guard.end(token);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    private static void emitStall(Ledger l, long serverTick, long durationMs, long flag) {
        l.events()
                .emitMap(
                        Names.Events.SERVER_STALL,
                        Severity.WARN,
                        Attrs.of()
                                .lng(AttrKeys.SERVER_TICK, serverTick)
                                .lng(AttrKeys.DURATION_MS, durationMs)
                                .lng(AttrKeys.FLAG, flag)
                                .build());
    }

    /** Watchdog thread: reads the volatile heartbeat and records through the ledger; no Bukkit state. */
    private void checkStall(
            StallDetector stall, BoundCounter stalls, CollectorGuard guard, Ledger l, CollectorContext ctx, long thresholdMs) {
        try {
            // The detector always advances (so a pause that ended while the guard was off is not reported later as a
            // huge one); only the recording is gated by the guard.
            boolean allowed = guard.allowed();
            boolean detected = stall.check();
            long pauseNanos = stall.takeRecoveredNanos();
            if (!allowed) {
                // Heartbeats are not stamped while the guard is off, so the pause that follows would be measured
                // across the whole off period: drop that recovery record too.
                suppressRecovery |= detected;
                return;
            }
            if (pauseNanos >= 0 && suppressRecovery) {
                suppressRecovery = false;
                pauseNanos = -1;
            }
            // Two records of geldar.server.stall: geldar.flag=1 at detection (duration_ms: the pause so far, at least
            // the threshold; it exists even if the server never recovers) and geldar.flag=0 at recovery (duration_ms:
            // the measured total pause).
            if (detected) {
                stalls.add(1);
                emitStall(l, ctx.host().serverTick(), Math.max(thresholdMs, stall.detectedNanos() / 1_000_000L), 1);
            }
            if (pauseNanos >= 0) {
                emitStall(l, ctx.host().serverTick(), pauseNanos / 1_000_000L, 0);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    @Override
    public synchronized void stop() {
        try {
            if (listener != null) {
                HandlerList.unregisterAll(listener);
                listener = null;
            }
        } catch (Throwable t) {
            // idempotent, best effort
        }
        if (tpsGauges != null) {
            tpsGauges.stop();
            tpsGauges = null;
        }
        if (managerTask != null) {
            managerTask.cancel();
            managerTask = null;
        }
        if (watchdog != null) {
            watchdog.stop();
            watchdog = null;
        }
    }
}
