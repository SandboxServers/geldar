package dev.geldar.ledger.paper.bridge;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import java.util.List;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.plugin.PluginManager;

/**
 * Exports the three bridge gauges (Chunky tasks running, CoreProtect queue, BlueMap enabled). Presence is probed on the
 * main thread every {@value #PROBE_EVERY_TICKS} ticks (a map lookup per plugin); the Chunky task files are read on an
 * async timer. Each bridge is wrapped on its own: a {@link Throwable} (including {@link NoClassDefFoundError}) from
 * one bridge zeroes that bridge only (S8). A missing plugin reads 0. Nothing here calls into the other plugins (S1, S11).
 */
public final class BridgeCollector implements Collector {
    public static final String ID = "bridge";
    static final int PROBE_EVERY_TICKS = 1200;
    static final long SCAN_EVERY_MS = 30_000L;

    private final Supplier<PluginManager> manager;
    private final List<Bridge> bridges;
    private volatile HostInfo host;
    private volatile Cancellable prober;
    private volatile Cancellable scanner;

    public BridgeCollector() {
        this(Bukkit::getPluginManager);
    }

    BridgeCollector(Supplier<PluginManager> manager) {
        this.manager = manager;
        this.bridges = List.of(new ChunkyBridge(), new CoreProtectBridge(), new BlueMapBridge());
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        host = ctx.host();
        for (Bridge b : bridges) {
            ctx.ledger().gaugeLong(b.metric(), "1", b.description(), b::value);
        }
        probe();
        prober = ctx.scheduler().everyTicks(PROBE_EVERY_TICKS, this::probe);
        scanner = ctx.scheduler().everyMillis(SCAN_EVERY_MS, this::scan);
    }

    @Override
    public void stop() {
        Cancellable p = prober;
        Cancellable s = scanner;
        prober = null;
        scanner = null;
        if (p != null) {
            p.cancel();
        }
        if (s != null) {
            s.cancel();
        }
    }

    /** Main thread: presence per bridge. Never throws. */
    void probe() {
        PluginManager pm;
        try {
            pm = manager.get();
        } catch (Throwable t) {
            pm = null;
        }
        for (Bridge b : bridges) {
            try {
                if (pm == null) {
                    b.clear();
                } else {
                    b.probe(pm);
                }
            } catch (Throwable t) {
                b.clear();
            }
        }
    }

    /** Async thread: file reads per bridge. Never throws; does nothing on the main thread. */
    void scan() {
        HostInfo h = host;
        if (h != null && h.isMainThread()) {
            return;
        }
        for (Bridge b : bridges) {
            try {
                b.scan();
            } catch (Throwable t) {
                b.clear();
            }
        }
    }

    /** Whether CoreProtect was seen enabled at the last probe (the queue gauge itself is always 0). */
    boolean coreProtectPresent() {
        return ((CoreProtectBridge) bridges.get(1)).present();
    }
}
