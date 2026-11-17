package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.HostScheduler;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Tick tasks run from {@link #onServerTick()} (call it once per server tick on the main thread); millisecond tasks run
 * on one daemon thread. A task that throws is dropped from that run only, never the scheduler.
 */
final class NeoForgeHostScheduler implements HostScheduler, AutoCloseable {
    private static final class TickTask {
        final int period;
        final Runnable body;
        volatile boolean cancelled;
        int elapsed;

        TickTask(int period, Runnable body) {
            this.period = period;
            this.body = body;
        }
    }

    private final AtomicLong ticks = new AtomicLong();
    private final List<TickTask> tickTasks = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService async = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ledger-async");
        t.setDaemon(true);
        return t;
    });

    long serverTick() {
        return ticks.get();
    }

    /** Advances the tick counter and runs due tick tasks. Main thread only. */
    void onServerTick() {
        ticks.incrementAndGet();
        for (TickTask task : tickTasks) {
            if (task.cancelled) {
                tickTasks.remove(task);
            } else if (++task.elapsed >= task.period) {
                task.elapsed = 0;
                try {
                    task.body.run();
                } catch (RuntimeException e) {
                    // The ledger's own tasks catch their errors; a leak here must not stop the tick.
                }
            }
        }
    }

    @Override
    public Cancellable everyTicks(int ticks, Runnable r) {
        TickTask task = new TickTask(Math.max(1, ticks), r);
        tickTasks.add(task);
        return () -> task.cancelled = true;
    }

    @Override
    public Cancellable everyMillis(long ms, Runnable r) {
        long period = Math.max(1, ms);
        var future = async.scheduleWithFixedDelay(() -> {
            try {
                r.run();
            } catch (RuntimeException e) {
                // scheduleWithFixedDelay would stop the task on a throw; keep it running.
            }
        }, period, period, TimeUnit.MILLISECONDS);
        return () -> future.cancel(false);
    }

    @Override
    public void close() {
        tickTasks.clear();
        async.shutdownNow();
    }
}