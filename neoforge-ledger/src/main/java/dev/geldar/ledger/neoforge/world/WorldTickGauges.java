package dev.geldar.ledger.neoforge.world;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Per-dimension tick time (A2). The server keeps a ring of 100 nanosecond values per dimension, written by the server
 * thread; the exporter thread never reads it. {@link #onServerTick()} (main thread) copies an average into a volatile
 * once per {@link #SAMPLE_EVERY_TICKS} ticks, and the gauge reader returns that volatile.
 */
public final class WorldTickGauges {
    public static final int SAMPLE_EVERY_TICKS = 20;
    private static final double NANOS_PER_MS = 1_000_000.0;

    private static final class Dim {
        final Supplier<long[]> source;
        volatile double avgMs;

        Dim(Supplier<long[]> source) {
            this.source = source;
        }
    }

    private final Map<String, Dim> dims = new LinkedHashMap<>();
    private int counter;

    /** {@code sources} maps a dimension name (the {@code world} attribute) to its tick-time ring reader. */
    public WorldTickGauges(Map<String, Supplier<long[]>> sources) {
        sources.forEach((name, src) -> dims.put(name, new Dim(src)));
    }

    /** Startup only. */
    public void register(Ledger ledger) {
        dims.forEach((name, d) -> ledger.gaugeDouble(
                Names.World.TICK_MS, "ms", "average tick time of a dimension", () -> d.avgMs, AttrKeys.M_WORLD, name));
    }

    /** Main thread, once per tick. */
    public void onServerTick() {
        if (++counter < SAMPLE_EVERY_TICKS) {
            return;
        }
        counter = 0;
        for (Dim d : dims.values()) {
            try {
                d.avgMs = average(d.source.get());
            } catch (RuntimeException e) {
                // keep the last value
            }
        }
    }

    /** Mean of the non-zero entries in milliseconds (the ring is zero-filled until full); 0 for null or empty. */
    static double average(long[] nanos) {
        if (nanos == null) {
            return 0.0;
        }
        long sum = 0;
        int n = 0;
        for (long v : nanos) {
            if (v != 0) {
                sum += v;
                n++;
            }
        }
        return n == 0 ? 0.0 : sum / (double) n / NANOS_PER_MS;
    }

    double avgMs(String dim) {
        return dims.get(dim).avgMs;
    }
}
