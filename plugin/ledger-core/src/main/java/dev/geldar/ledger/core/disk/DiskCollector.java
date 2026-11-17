package dev.geldar.ledger.core.disk;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Names;
import java.nio.file.Path;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicIntegerArray;
import java.util.concurrent.atomic.AtomicLongArray;

/**
 * Exports {@code geldar_disk_bytes{area}}. One area is walked per run on an async timer (never the main thread), so
 * a full round takes {@code areas x interval}. Each walk is bounded by an entry budget and a time budget; a walk that
 * hits either keeps its lower bound and sets the area's partial flag ({@link #isPartial}). Gauge readers are field
 * reads. Roots are injected by the adapter (it resolves relative paths against the server working directory).
 */
public final class DiskCollector implements Collector {
    public static final String ID = "disk";
    public static final long DEFAULT_INTERVAL_MS = 600_000L;

    private final Map<DiskArea, Path> roots;
    private final long maxEntries;
    private final long maxNanos;
    private final long intervalMs;
    private final DiskArea[] order;
    private final AtomicLongArray bytes = new AtomicLongArray(DiskArea.values().length);
    private final AtomicIntegerArray partial = new AtomicIntegerArray(DiskArea.values().length);
    private int next;
    private volatile HostInfo host;
    private volatile Cancellable timer;

    public DiskCollector(Map<DiskArea, Path> roots) {
        this(roots, DirSize.DEFAULT_MAX_ENTRIES, DirSize.DEFAULT_MAX_NANOS, DEFAULT_INTERVAL_MS);
    }

    public DiskCollector(Map<DiskArea, Path> roots, long maxEntries, long maxNanos, long intervalMs) {
        this.roots = new EnumMap<>(DiskArea.class);
        this.roots.putAll(roots);
        this.maxEntries = maxEntries;
        this.maxNanos = maxNanos;
        this.intervalMs = intervalMs;
        this.order = this.roots.keySet().toArray(new DiskArea[0]);
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        host = ctx.host();
        for (DiskArea a : order) {
            ctx.ledger()
                    .gaugeLong(
                            Names.Disk.BYTES,
                            "By",
                            "On-disk size of a server area",
                            () -> bytes.get(a.ordinal()),
                            // The frozen gauge API has no value binding; key and value are passed as a pair (guess).
                            "area",
                            a.attr());
        }
        timer = ctx.scheduler().everyMillis(intervalMs, this::sample);
    }

    @Override
    public void stop() {
        Cancellable t = timer;
        timer = null;
        if (t != null) {
            t.cancel();
        }
    }

    /** True when the last walk of the area stopped on a budget, so its value is a lower bound. */
    public boolean isPartial(DiskArea area) {
        return partial.get(area.ordinal()) != 0;
    }

    /** Last measured bytes of the area (0 until measured, or when its root is missing). */
    public long bytes(DiskArea area) {
        return bytes.get(area.ordinal());
    }

    /** One timer run: walks the next area. Never throws; does nothing on the main thread. */
    void sample() {
        try {
            HostInfo h = host;
            if (h != null && h.isMainThread() || order.length == 0) {
                return;
            }
            DiskArea area = order[next];
            next = (next + 1) % order.length;
            DirSize.Result r = DirSize.of(roots.get(area), maxEntries, maxNanos, System::nanoTime);
            bytes.set(area.ordinal(), r.available() ? r.bytes() : 0);
            partial.set(area.ordinal(), r.partial() ? 1 : 0);
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }
}
