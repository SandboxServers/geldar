package dev.geldar.ledger.core;

import java.util.ArrayList;
import java.util.List;

/**
 * A manual {@link HostScheduler}. Nothing runs until the test calls {@link #advanceTicks} or {@link #advanceMillis}.
 * Tick tasks and millisecond tasks are separate clocks. Single-threaded by design: tests drive it from one thread.
 */
public final class FakeHostScheduler implements HostScheduler {
    private final List<Task> tasks = new ArrayList<>();
    private int cancels;
    private long tickClock;
    private long millisClock;

    @Override
    public synchronized Cancellable everyTicks(int ticks, Runnable r) {
        if (ticks < 1) {
            throw new IllegalArgumentException("ticks must be at least 1");
        }
        return add(new Task(true, ticks, r, tickClock + ticks));
    }

    @Override
    public synchronized Cancellable everyMillis(long ms, Runnable r) {
        if (ms < 1) {
            throw new IllegalArgumentException("ms must be at least 1");
        }
        return add(new Task(false, ms, r, millisClock + ms));
    }

    /** Advances the tick clock one tick at a time, running each tick task whose period divides the new tick. */
    public void advanceTicks(int n) {
        for (int i = 0; i < n; i++) {
            step(true, ++tickClock);
        }
    }

    /** Advances the millisecond clock one millisecond at a time. */
    public void advanceMillis(long n) {
        for (long i = 0; i < n; i++) {
            step(false, ++millisClock);
        }
    }

    /** How many times a returned {@link Cancellable} was cancelled (a repeated cancel counts once per task). */
    public synchronized int cancelCount() {
        return cancels;
    }

    /** Tasks that are scheduled and not cancelled. */
    public synchronized int activeTasks() {
        return (int) tasks.stream().filter(t -> !t.cancelled).count();
    }

    private void step(boolean ticks, long now) {
        List<Task> due = new ArrayList<>();
        synchronized (this) {
            for (Task t : tasks) {
                if (!t.cancelled && t.ticks == ticks && now >= t.next) {
                    t.next += t.period;
                    due.add(t);
                }
            }
        }
        for (Task t : due) {
            if (!t.cancelled) {
                t.runnable.run();
            }
        }
    }

    private Cancellable add(Task t) {
        tasks.add(t);
        return () -> {
            synchronized (FakeHostScheduler.this) {
                if (!t.cancelled) {
                    t.cancelled = true;
                    cancels++;
                }
            }
        };
    }

    private static final class Task {
        final boolean ticks;
        final long period;
        final Runnable runnable;
        long next;
        boolean cancelled;

        Task(boolean ticks, long period, Runnable runnable, long next) {
            this.ticks = ticks;
            this.period = period;
            this.runnable = runnable;
            this.next = next;
        }
    }
}