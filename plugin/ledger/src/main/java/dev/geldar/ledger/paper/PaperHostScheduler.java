package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.HostScheduler;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;

/**
 * {@link HostScheduler} over Paper's {@link BukkitScheduler}. {@code everyTicks} runs on the main thread;
 * {@code everyMillis} runs on an async worker (file I/O belongs there, S6). A task that throws is logged (the first
 * few times only) and keeps its schedule: the shell never throws into the host.
 */
final class PaperHostScheduler implements HostScheduler {
    static final long MS_PER_TICK = 50;
    private static final int MAX_ERROR_LOGS = 3;

    private final Plugin plugin;
    private final BukkitScheduler scheduler;
    private final Logger log;
    private final AtomicInteger errors = new AtomicInteger();

    PaperHostScheduler(Plugin plugin, BukkitScheduler scheduler, Logger log) {
        this.plugin = plugin;
        this.scheduler = scheduler;
        this.log = log;
    }

    @Override
    public Cancellable everyTicks(int ticks, Runnable r) {
        long period = Math.max(1, ticks);
        BukkitTask task = scheduler.runTaskTimer(plugin, guarded(r), period, period);
        return task::cancel;
    }

    @Override
    public Cancellable everyMillis(long ms, Runnable r) {
        BukkitTask task = scheduler.runTaskTimerAsynchronously(plugin, guarded(r), 1, periodTicks(ms));
        return task::cancel;
    }

    /** Milliseconds to whole ticks, rounded up, at least one tick. */
    static long periodTicks(long ms) {
        return Math.max(1, (ms + MS_PER_TICK - 1) / MS_PER_TICK);
    }

    private Runnable guarded(Runnable r) {
        return () -> {
            try {
                r.run();
            } catch (Throwable t) {
                int n = errors.incrementAndGet();
                if (n <= MAX_ERROR_LOGS) {
                    log.log(Level.WARNING, "Ledger task failed: " + t.getClass().getSimpleName());
                }
            }
        };
    }
}
