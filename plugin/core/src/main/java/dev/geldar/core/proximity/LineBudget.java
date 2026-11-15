package dev.geldar.core.proximity;

/**
 * The per-line read budget (decision 0199, step 5): a chat line may read at most {@code cap} blocks in total, across
 * every listener. The caller takes the reads of each ray; a take over what remains is refused and deducts nothing,
 * and the caller counts the listener as silent. Not thread-safe: one line is handled on one thread.
 */
public final class LineBudget {
    private final int cap;
    private int remaining;

    /** A budget of {@code cap} reads. A negative cap is refused. */
    public LineBudget(int cap) {
        if (cap < 0) {
            throw new IllegalArgumentException("cap must not be negative: " + cap);
        }
        this.cap = cap;
        this.remaining = cap;
    }

    /** The reads left before the cap. */
    public int remaining() {
        return remaining;
    }

    /**
     * Deducts {@code reads} and returns true, when {@code reads} is between 0 and what remains. Otherwise returns
     * false and deducts nothing.
     */
    public boolean take(int reads) {
        if (reads < 0 || reads > remaining) {
            return false;
        }
        remaining -= reads;
        return true;
    }

    /** The cap this budget was made with. */
    public int cap() {
        return cap;
    }
}
