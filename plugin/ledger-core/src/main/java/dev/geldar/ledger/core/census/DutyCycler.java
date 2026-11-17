package dev.geldar.ledger.core.census;

/**
 * Duty-cycle decision for one census event class: counting is on for {@code onTicks} of every
 * {@code periodTicks} server ticks (config format {@code on/period}). Pure and immutable; the
 * caller supplies the tick, nothing here reads a clock.
 */
public final class DutyCycler {
    /** Always on (period 0). */
    public static final DutyCycler ALWAYS_ON = new DutyCycler(0, 0);

    private final int onTicks;
    private final int periodTicks;

    /**
     * @param onTicks ticks counted per period, 0 to {@code periodTicks}
     * @param periodTicks cycle length; 0 means always on (then {@code onTicks} must be 0)
     * @throws IllegalArgumentException for a negative value or {@code onTicks > periodTicks}
     */
    public DutyCycler(int onTicks, int periodTicks) {
        if (onTicks < 0 || periodTicks < 0) {
            throw new IllegalArgumentException("duty values must not be negative");
        }
        if (onTicks > periodTicks) {
            throw new IllegalArgumentException("onTicks " + onTicks + " exceeds periodTicks " + periodTicks);
        }
        this.onTicks = onTicks;
        this.periodTicks = periodTicks;
    }

    /** True when events on this server tick are counted. */
    public boolean on(long serverTick) {
        if (periodTicks == 0) {
            return true;
        }
        return Math.floorMod(serverTick, (long) periodTicks) < onTicks;
    }

    /** The fraction of ticks that are counted, 1.0 for always on. */
    public double ratio() {
        return periodTicks == 0 ? 1.0 : (double) onTicks / periodTicks;
    }

    public int onTicks() {
        return onTicks;
    }

    public int periodTicks() {
        return periodTicks;
    }
}
