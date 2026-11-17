package dev.geldar.ledger.paper.tick;

import com.destroystokyo.paper.event.server.ServerTickEndEvent;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.tick.StallDetector;
import dev.geldar.ledger.core.tick.TickStats;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Records every tick end (PT-04b). Runs on the main thread: bound instruments, the ring-slot event record and the
 * guard only. Never throws into the server.
 */
public final class TickEndListener implements Listener {
    private final BoundHistogram lag;
    private final BoundCounter overruns;
    private final TickStats stats;
    private final StallDetector stall;
    private final CollectorGuard guard;
    private final EventLog events;
    private final int slowTickId;

    public TickEndListener(
            BoundHistogram lag,
            BoundCounter overruns,
            TickStats stats,
            StallDetector stall,
            CollectorGuard guard,
            EventLog events,
            int slowTickId) {
        this.lag = lag;
        this.overruns = overruns;
        this.stats = stats;
        this.stall = stall;
        this.guard = guard;
        this.events = events;
        this.slowTickId = slowTickId;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onTickEnd(ServerTickEndEvent e) {
        try {
            if (!guard.allowed()) {
                return;
            }
            long token = guard.begin();
            try {
                double ms = e.getTickDuration(); // Paper: milliseconds
                lag.record(ms);
                if (ms > TickStats.OVERRUN_MS) {
                    overruns.add(1);
                }
                boolean slow = stats.onTick(ms);
                stall.heartbeat();
                if (slow) {
                    events.record(slowTickId, e.getTickNumber(), Math.round(ms), stats.overruns(), "", "", "");
                }
            } finally {
                guard.end(token);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }
}
