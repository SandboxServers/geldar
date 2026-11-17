package dev.geldar.core.blockowner;

import java.util.function.LongSupplier;
import java.util.logging.Logger;

/**
 * Logs why a CoreProtect lookup failed: the first failure at once, then at most one WARNING per {@link #WINDOW_MS},
 * which counts the failures it held back. A failure is shown by its root cause (class, message and at most
 * {@link #MAX_FRAMES} stack frames of that cause). Player names and coordinates are never logged.
 */
final class LookupFailureLog {
    static final long WINDOW_MS = 5 * 60_000L;
    static final int MAX_FRAMES = 10;
    private static final int MAX_CAUSE_DEPTH = 20;

    private final Logger log;
    private final LongSupplier clockMs;
    private boolean logged;
    private long lastLoggedMs;
    private long suppressed;

    LookupFailureLog(Logger log, LongSupplier clockMs) {
        this.log = log;
        this.clockMs = clockMs;
    }

    /** Records one failure; {@code cause} is null for a refusal that has no exception. */
    synchronized void failed(String reason, Throwable cause) {
        long now = clockMs.getAsLong();
        if (logged && now - lastLoggedMs < WINDOW_MS) {
            suppressed++;
            return;
        }
        log.warning(describe(reason, cause));
        logged = true;
        lastLoggedMs = now;
        suppressed = 0;
    }

    private String describe(String reason, Throwable cause) {
        StringBuilder text = new StringBuilder("Block owner queries answer unknown: ").append(reason);
        if (suppressed > 0) {
            text.append(" (").append(suppressed).append(" more failures since the last report)");
        }
        if (cause != null) {
            Throwable root = rootCause(cause);
            text.append("; root cause ").append(root.getClass().getName()).append(": ").append(root.getMessage());
            StackTraceElement[] frames = root.getStackTrace();
            for (int i = 0; i < Math.min(MAX_FRAMES, frames.length); i++) {
                text.append("\n    at ").append(frames[i]);
            }
        }
        return text.toString();
    }

    /** The innermost cause, following the chain for a bounded number of links. */
    static Throwable rootCause(Throwable t) {
        Throwable cur = t;
        for (int depth = 0; depth < MAX_CAUSE_DEPTH && cur.getCause() != null && cur.getCause() != cur; depth++) {
            cur = cur.getCause();
        }
        return cur;
    }
}
