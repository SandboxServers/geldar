package dev.geldar.ledger.core;

import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/** A settable nanosecond clock for {@link TokenBucket}, {@link EventRing} and tests of time-based logic. */
public final class FakeClock implements LongSupplier {
    private final AtomicLong nanos;

    public FakeClock() {
        this(0L);
    }

    public FakeClock(long startNanos) {
        this.nanos = new AtomicLong(startNanos);
    }

    @Override
    public long getAsLong() {
        return nanos.get();
    }

    public void set(long value) {
        nanos.set(value);
    }

    public void advanceNanos(long n) {
        nanos.addAndGet(n);
    }

    public void advanceMillis(long ms) {
        nanos.addAndGet(ms * 1_000_000L);
    }
}