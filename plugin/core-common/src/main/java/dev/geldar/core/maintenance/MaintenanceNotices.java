package dev.geldar.core.maintenance;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.logging.Logger;

/**
 * Turns maintenance notices into server lines. {@link #receive} may be called from the NATS thread: it validates,
 * dedupes by notice id, rate-limits and then hands the line to the server thread through {@code mainThread}, because
 * Bukkit broadcasts are not thread-safe. With {@code maintenance.broadcast} off nothing is said, and a line already
 * handed over is dropped too. A notice is counted once per id, even when the rate limit drops it: a late redelivery
 * does not announce a stale notice.
 */
public final class MaintenanceNotices {
    /** Most lines broadcast in one {@link #WINDOW_MILLIS} window; a flood of notices cannot spam the chat. */
    public static final int MAX_PER_WINDOW = 4;
    public static final long WINDOW_MILLIS = 60_000;
    /** Notice ids remembered for dedupe; the oldest is forgotten first. */
    static final int SEEN_IDS = 64;

    private final Consumer<String> broadcast;
    private final Executor mainThread;
    private final LongSupplier clock;
    private final Logger log;
    private final Set<String> seen = new LinkedHashSet<>();
    private final Deque<Long> sent = new ArrayDeque<>();
    private volatile boolean enabled;

    public MaintenanceNotices(
            boolean enabled, Consumer<String> broadcast, Executor mainThread, LongSupplier clockMillis, Logger log) {
        this.enabled = enabled;
        this.broadcast = broadcast;
        this.mainThread = mainThread;
        this.clock = clockMillis;
        this.log = log;
    }

    /** Config reload: {@code maintenance.broadcast}. Lines already handed to the server thread are dropped too. */
    public void setEnabled(boolean value) {
        enabled = value;
    }

    /** Handles one notice payload. Any thread; never throws, whatever the payload or the server does. */
    public void receive(String json) {
        try {
            Optional<MaintenanceNotice> parsed = MaintenanceNotice.parse(json);
            if (parsed.isEmpty() || !enabled) {
                return;
            }
            Optional<String> line = parsed.get().line();
            if (line.isEmpty() || !admit(parsed.get().id())) {
                return;
            }
            String text = line.get();
            mainThread.execute(() -> say(text));
        } catch (RuntimeException e) {
            log.warning("Maintenance notice not broadcast: " + e.getClass().getSimpleName());
        }
    }

    /** Dedupe and rate limit; true when this notice may be broadcast now. */
    private synchronized boolean admit(String id) {
        if (!seen.add(id)) {
            return false;
        }
        if (seen.size() > SEEN_IDS) {
            Iterator<String> oldest = seen.iterator();
            oldest.next();
            oldest.remove();
        }
        long now = clock.getAsLong();
        while (!sent.isEmpty() && now - sent.peekFirst() >= WINDOW_MILLIS) {
            sent.pollFirst();
        }
        if (sent.size() >= MAX_PER_WINDOW) {
            return false;
        }
        sent.addLast(now);
        return true;
    }

    /** Server thread. Checks the switch again: a line queued before a switch-off is not said. */
    private void say(String text) {
        if (!enabled) {
            return;
        }
        try {
            broadcast.accept(text);
        } catch (RuntimeException e) {
            log.warning("Maintenance line not broadcast: " + e.getClass().getSimpleName());
        }
    }
}
