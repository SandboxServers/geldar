package dev.geldar.neoforge;

/**
 * The last minute of tick times (1200 ticks at 20 TPS). {@link #tps()} is {@code min(20, 1000 / mean ms)} over the
 * ticks recorded so far. Unfilled slots are not counted, so a fresh server does not read as slow. Server thread only.
 */
public final class TickWindow {
    /** One minute of ticks at the nominal 20 TPS. */
    public static final int SIZE = 1200;
    /** The cap of the Bukkit-style figure. */
    public static final double MAX_TPS = 20.0;

    private final long[] nanos = new long[SIZE];
    private int next;
    private int filled;

    /** Records one tick's duration in nanoseconds; a negative duration is stored as zero. */
    public void record(long tickNanos) {
        nanos[next] = Math.max(0L, tickNanos);
        next = (next + 1) % SIZE;
        if (filled < SIZE) {
            filled++;
        }
    }

    /** How many ticks are in the window (at most {@link #SIZE}). */
    public int size() {
        return filled;
    }

    /** The derived TPS; {@link #MAX_TPS} with no ticks recorded or a zero mean. */
    public double tps() {
        if (filled == 0) {
            return MAX_TPS;
        }
        long sum = 0;
        for (int i = 0; i < filled; i++) {
            sum += nanos[i];
        }
        double meanMs = sum / (double) filled / 1_000_000.0;
        if (meanMs <= 0.0) {
            return MAX_TPS;
        }
        return Math.min(MAX_TPS, 1000.0 / meanMs);
    }
}
