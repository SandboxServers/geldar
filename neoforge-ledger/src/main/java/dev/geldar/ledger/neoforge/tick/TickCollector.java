package dev.geldar.ledger.neoforge.tick;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.tick.StallDetector;
import dev.geldar.ledger.core.tick.TickStats;
import dev.geldar.ledger.neoforge.world.WorldTickGauges;
import java.util.Map;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Tick lag, overruns, stalls and the per-dimension tick time on NeoForge (PT-N4a). The server calls {@link #listener()}
 * from the tick events; the stall watchdog is its own daemon thread, never the host scheduler.
 */
public final class TickCollector implements Collector {
    public static final String ID = "tick";
    public static final long STALL_CHECK_MS = 500;
    private static final int SLOW_TICK_RATE_PER_SECOND = 5;

    private final LongSupplier nanoClock;
    private final StallWatchdog.Sleeper sleeper;
    private final Map<String, Supplier<long[]>> dimensions;
    private volatile TickListener listener;
    private StallWatchdog watchdog;

    /** {@code dimensions} maps a dimension name to its tick-time ring reader (main thread only). */
    public TickCollector(Map<String, Supplier<long[]>> dimensions) {
        this(dimensions, System::nanoTime, Thread::sleep);
    }

    TickCollector(Map<String, Supplier<long[]>> dimensions, LongSupplier nanoClock, StallWatchdog.Sleeper sleeper) {
        this.dimensions = Map.copyOf(dimensions);
        this.nanoClock = nanoClock;
        this.sleeper = sleeper;
    }

    @Override
    public String id() {
        return ID;
    }

    /** The listener to call from the tick events; null before start and after stop. */
    public TickListener listener() {
        return listener;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        CollectorGuard guard = l.guard(ID);
        long thresholdMs = l.config().stallThresholdMs();
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
        WorldTickGauges world = new WorldTickGauges(dimensions);
        world.register(l);
        TickListener built = new TickListener(
                l.histogram(Names.Tick.LAG_MS, "ms", "tick duration", TickStats.BOUNDS).bind(),
                l.counter(Names.Tick.OVERRUNS_TOTAL, "1", "ticks over 50 ms").bind(),
                new TickStats(),
                stall,
                guard,
                l.events(),
                slowId,
                nanoClock,
                world);
        watchdog = new StallWatchdog(
                STALL_CHECK_MS, sleeper, () -> checkStall(stall, stalls, guard, l, ctx, thresholdMs));
        watchdog.start();
        listener = built;
    }

    /** Watchdog thread: reads the volatile heartbeat and records through the ledger; no server state. */
    private static void checkStall(
            StallDetector stall,
            BoundCounter stalls,
            CollectorGuard guard,
            Ledger l,
            CollectorContext ctx,
            long thresholdMs) {
        try {
            if (!guard.allowed() || !stall.check()) {
                return;
            }
            stalls.add(1);
            l.events()
                    .emitMap(
                            Names.Events.SERVER_STALL,
                            Severity.WARN,
                            Attrs.of()
                                    .lng(AttrKeys.SERVER_TICK, ctx.host().serverTick())
                                    .lng(AttrKeys.DURATION_MS, thresholdMs)
                                    .build());
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    @Override
    public synchronized void stop() {
        listener = null;
        if (watchdog != null) {
            watchdog.stop();
            watchdog = null;
        }
    }
}
