package dev.geldar.core.blockowner;

import java.util.function.LongSupplier;
import java.util.logging.Logger;

/**
 * The {@code blockowner.debug} lines: one per raw CoreProtect row and one summary per chunk query, at INFO. Off by
 * default; when off nothing is logged and callers do not build the text. When on, at most
 * {@link #MAX_LINES_PER_MINUTE} lines are written a minute, so a busy chunk cannot flood the console. The lines name no
 * player: a row says only whether its user is a player or a system user.
 */
final class LookupDebugLog {
    static final int MAX_LINES_PER_MINUTE = 20;
    static final long MINUTE_MS = 60_000L;

    private final Logger log;
    private final LongSupplier clockMs;
    private volatile boolean enabled;
    private long windowStartMs;
    private int linesInWindow;

    LookupDebugLog(Logger log, LongSupplier clockMs) {
        this.log = log;
        this.clockMs = clockMs;
    }

    /** A log that is never on; used where no config has been read. */
    static LookupDebugLog disabled() {
        return new LookupDebugLog(Logger.getLogger(LookupDebugLog.class.getName()), System::currentTimeMillis);
    }

    /** Applies {@code blockowner.debug} (the config reload). */
    void setEnabled(boolean on) {
        enabled = on;
    }

    boolean enabled() {
        return enabled;
    }

    /** Writes one line when debug is on and this minute still has room; otherwise drops it. */
    synchronized void info(String line) {
        if (!enabled) {
            return;
        }
        long now = clockMs.getAsLong();
        if (now - windowStartMs >= MINUTE_MS) {
            windowStartMs = now;
            linesInWindow = 0;
        }
        if (linesInWindow >= MAX_LINES_PER_MINUTE) {
            return;
        }
        linesInWindow++;
        log.info("blockowner.debug: " + line);
    }
}
