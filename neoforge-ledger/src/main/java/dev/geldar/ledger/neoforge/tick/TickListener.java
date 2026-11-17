package dev.geldar.ledger.neoforge.tick;

import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.tick.StallDetector;
import dev.geldar.ledger.core.tick.TickStats;
import dev.geldar.ledger.neoforge.world.WorldTickGauges;
import java.util.function.LongSupplier;

/**
 * Records every tick (PT-N4a). {@link #pre()} and {@link #post(long)} run on the main thread, from
 * {@code ServerTickEvent.Pre} and {@code .Post}: bound instruments, the ring-slot event record and the guard only. No
 * Minecraft types, so it is tested with fakes. Never throws into the server.
 */
public final class TickListener {
    private final BoundHistogram lag;
    private final BoundCounter overruns;
    private final TickStats stats;
    private final StallDetector stall;
    private final CollectorGuard guard;
    private final EventLog events;
    private final int slowTickId;
    private final LongSupplier nanoClock;
    private final WorldTickGauges world;
    private long preStamp;
    private boolean havePre;

    TickListener(
            BoundHistogram lag,
            BoundCounter overruns,
            TickStats stats,
            StallDetector stall,
            CollectorGuard guard,
            EventLog events,
            int slowTickId,
            LongSupplier nanoClock,
            WorldTickGauges world) {
        this.lag = lag;
        this.overruns = overruns;
        this.stats = stats;
        this.stall = stall;
        this.guard = guard;
        this.events = events;
        this.slowTickId = slowTickId;
        this.nanoClock = nanoClock;
        this.world = world;
    }

    public void pre() {
        try {
            preStamp = nanoClock.getAsLong();
            havePre = true;
        } catch (Throwable t) {
            havePre = false;
        }
    }

    public void post(long tickNumber) {
        try {
            if (!havePre) {
                return;
            }
            havePre = false;
            if (!guard.allowed()) {
                return;
            }
            long token = guard.begin();
            try {
                double ms = (nanoClock.getAsLong() - preStamp) / 1_000_000.0;
                lag.record(ms);
                if (ms > TickStats.OVERRUN_MS) {
                    overruns.add(1);
                }
                boolean slow = stats.onTick(ms);
                stall.heartbeat();
                world.onServerTick();
                if (slow) {
                    events.record(slowTickId, tickNumber, Math.round(ms), stats.overruns(), "", "", "");
                }
            } finally {
                guard.end(token);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }
}
