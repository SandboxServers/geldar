package dev.geldar.ledger.neoforge.tick;

/**
 * A daemon thread that runs a check every period, independent of the host scheduler (tick tasks cannot fire while the
 * main thread hangs; this thread can). The check must not touch server state. Never throws; {@link #stop()}
 * interrupts and joins for at most one second.
 */
final class StallWatchdog {
    static final String THREAD_NAME = "ledger-stall-watchdog";
    static final long JOIN_MS = 1_000;

    /** The sleep seam: tests replace it with a latch-driven fake. */
    interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    private final long periodMs;
    private final Sleeper sleeper;
    private final Runnable check;
    private volatile boolean stopped;
    private Thread thread;

    StallWatchdog(long periodMs, Sleeper sleeper, Runnable check) {
        this.periodMs = periodMs;
        this.sleeper = sleeper;
        this.check = check;
    }

    synchronized void start() {
        if (thread != null) {
            return;
        }
        stopped = false;
        Thread t = new Thread(this::run, THREAD_NAME);
        t.setDaemon(true);
        thread = t;
        t.start();
    }

    private void run() {
        Thread self = Thread.currentThread();
        while (!stopped && !self.isInterrupted()) {
            try {
                sleeper.sleep(periodMs);
            } catch (InterruptedException e) {
                return;
            } catch (Throwable t) {
                return; // a broken sleeper must not spin
            }
            try {
                check.run();
            } catch (Throwable t) {
                // never throw into the host; the next period retries
            }
        }
    }

    /** Idempotent. */
    synchronized void stop() {
        Thread t = thread;
        thread = null;
        if (t == null) {
            return;
        }
        stopped = true; // a check that swallowed the interrupt still ends the loop
        try {
            t.interrupt();
            t.join(JOIN_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Throwable e) {
            // best effort
        }
    }

    synchronized boolean running() {
        return thread != null && thread.isAlive();
    }
}
