package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.HostScheduler;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;

/**
 * Tick tasks run from {@link #onServerTick()} (call it once per server tick on the main thread); millisecond tasks run
 * on one daemon thread. A task that throws anything but a {@link VirtualMachineError} is contained and logged once per
 * task (exception class name only). After {@link #close()} scheduling is a no-op that returns a harmless handle.
 * Tick tasks run inline on the server thread and the async side is one thread: a slow task delays the others, and
 * only the ledger's own budget guard bounds that.
 */
final class NeoForgeHostScheduler implements HostScheduler, AutoCloseable {
    private static final Cancellable NOOP = () -> {};

    private static final class TickTask {
        final int period;
        final Runnable body;
        volatile boolean cancelled;
        boolean logged;
        int elapsed;

        TickTask(int period, Runnable body) {
            this.period = period;
            this.body = body;
        }
    }

    private final Logger log;
    private final AtomicLong ticks = new AtomicLong();
    private final List<TickTask> tickTasks = new CopyOnWriteArrayList<>();
    private volatile boolean closed;
    private final ScheduledExecutorService async = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ledger-async");
        t.setDaemon(true);
        return t;
    });

    NeoForgeHostScheduler(Logger log) {
        this.log = log;
    }

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
                } catch (Throwable t) {
                    if (t instanceof VirtualMachineError vme) {
                        throw vme;
                    }
                    if (!task.logged) {
                        task.logged = true;
                        log.warning("ledger tick task failed: " + t.getClass().getName());
                    }
                }
            }
        }
    }

    @Override
    public Cancellable everyTicks(int ticks, Runnable r) {
        if (closed) {
            return NOOP;
        }
        TickTask task = new TickTask(Math.max(1, ticks), r);
        tickTasks.add(task);
        return () -> task.cancelled = true;
    }

    @Override
    public Cancellable everyMillis(long ms, Runnable r) {
        if (closed) {
            return NOOP;
        }
        long period = Math.max(1, ms);
        boolean[] logged = {false};
        try {
            var future = async.scheduleWithFixedDelay(() -> {
                try {
                    r.run();
                } catch (Throwable t) {
                    if (t instanceof VirtualMachineError vme) {
                        throw vme;
                    }
                    // scheduleWithFixedDelay would stop the task on a throw; keep it running.
                    if (!logged[0]) {
                        logged[0] = true;
                        log.warning("ledger async task failed: " + t.getClass().getName());
                    }
                }
            }, period, period, TimeUnit.MILLISECONDS);
            return () -> future.cancel(false);
        } catch (RejectedExecutionException e) {
            return NOOP;
        }
    }

    @Override
    public void close() {
        closed = true;
        tickTasks.clear();
        async.shutdown();
    }
}