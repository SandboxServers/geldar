package dev.geldar.ledger.core.container;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.nio.file.Path;

/**
 * Container CPU throttling and memory from cgroup v2 (PT-09c). Reads run only on the scheduler's async task
 * ({@code everyMillis}), never on the calling thread of {@link #start}. The frozen API has no observable counter, so
 * the {@code _total} names are exported as MONOTONIC GAUGES of the running total (dashboards treat them as
 * counters). When the kernel counter goes backwards (container restart, wrap) the earlier total is carried forward,
 * so the exported value never decreases. If the cgroup is unavailable the collector logs once and stops polling.
 */
public final class CgroupCollector implements Collector {
    public static final String ID = "container";
    public static final long PERIOD_MS = 15_000;

    private static final System.Logger LOG = System.getLogger(CgroupCollector.class.getName());

    /** Running total that never decreases across raw resets. Written by the poll thread only, read anywhere. */
    static final class Monotonic {
        private volatile long exported;
        private long base;
        private long last;

        void update(long raw) {
            if (raw < last) {
                base += last;
            }
            last = raw;
            exported = base + raw;
        }

        long value() {
            return exported;
        }
    }

    private final CgroupReader reader;
    private final Monotonic periods = new Monotonic();
    private final Monotonic throttled = new Monotonic();
    private final Monotonic throttledUsec = new Monotonic();
    private volatile long memory;
    private volatile long memoryLimit;
    private volatile boolean stopped;
    private volatile Cancellable task;

    public CgroupCollector() {
        this(Path.of(CgroupReader.DEFAULT_ROOT));
    }

    public CgroupCollector(Path root) {
        this.reader = new CgroupReader(root);
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        try {
            Ledger l = ctx.ledger();
            l.gaugeLong(Names.Container.CPU_PERIODS_TOTAL, "1", "cgroup cpu periods (monotonic)", periods::value);
            l.gaugeLong(
                    Names.Container.CPU_THROTTLED_PERIODS_TOTAL,
                    "1",
                    "cgroup throttled periods (monotonic)",
                    throttled::value);
            l.gaugeDouble(
                    Names.Container.CPU_THROTTLED_SECONDS_TOTAL,
                    "s",
                    "cgroup throttled time (monotonic)",
                    () -> throttledUsec.value() / 1e6);
            l.gaugeLong(Names.Container.MEMORY_BYTES, "By", "cgroup memory.current", () -> memory);
            l.gaugeLong(Names.Container.MEMORY_LIMIT_BYTES, "By", "cgroup memory.max, 0 when unlimited", () -> memoryLimit);
            task = ctx.scheduler().everyMillis(PERIOD_MS, this::poll);
        } catch (RuntimeException e) {
            LOG.log(System.Logger.Level.WARNING, "container collector failed to start: " + e);
        }
    }

    /** One async poll. Package-private for tests. */
    void poll() {
        if (stopped) {
            return;
        }
        CgroupReader.Sample s = reader.read();
        if (s == null) {
            LOG.log(System.Logger.Level.INFO, "cgroup v2 files unavailable, container collector stops");
            stop();
            return;
        }
        periods.update(s.periods());
        throttled.update(s.throttledPeriods());
        throttledUsec.update(s.throttledUsec());
        memory = s.memoryCurrent();
        memoryLimit = s.memoryLimit();
    }

    @Override
    public void stop() {
        stopped = true;
        Cancellable t = task;
        if (t != null) {
            t.cancel();
        }
    }

    boolean isStopped() {
        return stopped;
    }

    long periodsTotal() {
        return periods.value();
    }

    long throttledTotal() {
        return throttled.value();
    }

    double throttledSecondsTotal() {
        return throttledUsec.value() / 1e6;
    }

    long memoryBytes() {
        return memory;
    }

    long memoryLimitBytes() {
        return memoryLimit;
    }
}
