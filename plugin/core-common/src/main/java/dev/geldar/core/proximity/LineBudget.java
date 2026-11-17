package dev.geldar.core.proximity;

/**
 * The per-line read budget (decision 0199, step 5): a chat line may read at most {@code cap} blocks in total, across
 * every listener. The caller takes the reads of each ray. A take over what remains is refused and deducts nothing,
 * and the refusal latches: from then on every take is refused and {@link #remaining()} reports 0. So the order in
 * which listeners are handled cannot change who is silenced. Not thread-safe: one line is handled on one thread.
 */
public final class LineBudget {
    private final int cap;
    private int remaining;
    private boolean exhausted;

    /** A budget of {@code cap} reads. A negative cap is refused. */
    public LineBudget(int cap) {
        if (cap < 0) {
            throw new IllegalArgumentException("cap must not be negative: " + cap);
        }
        this.cap = cap;
        this.remaining = cap;
    }

    /** The reads left before the cap; 0 once a take has been refused. */
    public int remaining() {
        return exhausted ? 0 : remaining;
    }

    /**
     * Deducts {@code reads} and returns true, when {@code reads} is between 0 and what remains and no take has been
     * refused yet. Otherwise returns false, deducts nothing and latches the budget exhausted.
     */
    public boolean take(int reads) {
        if (exhausted || reads < 0 || reads > remaining) {
            exhausted = true;
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
