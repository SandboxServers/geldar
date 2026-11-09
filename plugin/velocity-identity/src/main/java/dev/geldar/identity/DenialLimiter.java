package dev.geldar.identity;

import java.util.function.IntConsumer;
import java.util.function.LongSupplier;

/**
 * Limits how many denials are logged: at most {@code max} per window, the rest are counted. The count is
 * reported when the window rolls over, either on the next denial or on {@link #tick()}, so a burst that
 * stops is still summarised.
 */
final class DenialLimiter {
    private final int max;
    private final long windowNanos;
    private final LongSupplier clock;
    private final IntConsumer summary;
    private long windowStart;
    private int logged;
    private int suppressed;

    DenialLimiter(int max, long windowNanos, LongSupplier clock, IntConsumer summary) {
        this.max = max;
        this.windowNanos = windowNanos;
        this.clock = clock;
        this.summary = summary;
        this.windowStart = clock.getAsLong();
    }

    /** True when this denial may be logged; false when it is only counted. */
    synchronized boolean allow() {
        roll();
        if (logged >= max) {
            suppressed++;
            return false;
        }
        logged++;
        return true;
    }

    /** Rolls an elapsed window over without needing another denial: call it on a timer. */
    synchronized void tick() {
        roll();
    }

    private void roll() {
        long now = clock.getAsLong();
        if (now - windowStart < windowNanos) {
            return;
        }
        if (suppressed > 0) {
            summary.accept(suppressed);
        }
        windowStart = now;
        logged = 0;
        suppressed = 0;
    }
}
