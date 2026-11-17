package dev.geldar.ledger.paper.tick;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.function.Supplier;

/**
 * {@code geldar_tps{window}} for 1m, 5m and 15m. The server's TPS array is read on the async scheduler every 5 s into
 * a volatile copy; the exporter-thread readers return the copy and never call the server (PT-04b).
 */
public final class TpsGauges {
    public static final long PERIOD_MS = 5_000;
    static final String[] WINDOWS = {"1m", "5m", "15m"};

    private final Supplier<double[]> source;
    private volatile double[] cached = {0, 0, 0};
    private volatile Cancellable task;

    /** {@code source} is the seam for {@code Bukkit.getTPS()}; it is called only from the async refresh. */
    public TpsGauges(Supplier<double[]> source) {
        this.source = source;
    }

    public void start(Ledger ledger, HostScheduler scheduler) {
        for (int i = 0; i < WINDOWS.length; i++) {
            final int idx = i;
            ledger.gaugeDouble(Names.Tick.TPS, "1", "server ticks per second", () -> cached[idx], AttrKeys.M_WINDOW, WINDOWS[i]);
        }
        task = scheduler.everyMillis(PERIOD_MS, this::refresh);
    }

    /** Async thread. Never throws. */
    void refresh() {
        try {
            double[] v = source.get();
            if (v != null && v.length >= WINDOWS.length) {
                cached = new double[] {v[0], v[1], v[2]};
            }
        } catch (Throwable t) {
            // keep the previous values
        }
    }

    public void stop() {
        Cancellable t = task;
        task = null;
        if (t != null) {
            t.cancel();
        }
    }
}
