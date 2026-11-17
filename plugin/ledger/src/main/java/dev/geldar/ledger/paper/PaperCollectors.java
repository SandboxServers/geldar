package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.LedgerConfig;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.logging.Logger;

/**
 * The collectors the plugin knows by name. A class that is absent is skipped silently (its card has not landed);
 * every present one is instantiated once and started or stopped by {@link #apply} from the config. A collector whose
 * {@code start} throws is switched off for the rest of the run and the others are not affected (S8).
 */
final class PaperCollectors {
    /** Every planned collector class (PT-04b to PT-10b), listed once. Missing classes are skipped. */
    static final List<String> NAMES = List.of(
            "dev.geldar.ledger.paper.tick.TickCollector",
            "dev.geldar.ledger.paper.spark.SparkCollector",
            "dev.geldar.ledger.paper.world.WorldCollector",
            "dev.geldar.ledger.paper.server.ServerCollector",
            "dev.geldar.ledger.paper.census.CensusCollector",
            "dev.geldar.ledger.paper.curated.CuratedCollector",
            "dev.geldar.ledger.paper.players.ConnectionCollector",
            "dev.geldar.ledger.paper.players.SnapshotCollector",
            "dev.geldar.ledger.paper.players.ProgressCollector",
            "dev.geldar.ledger.paper.players.ClientCadenceCollector",
            "dev.geldar.ledger.paper.bridge.BridgeCollector",
            "dev.geldar.ledger.core.container.CgroupCollector",
            "dev.geldar.ledger.core.disk.DiskCollector");

    private static final class Entry {
        final Collector collector;
        boolean running;
        boolean failed;

        Entry(Collector collector) {
            this.collector = collector;
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private final CollectorContext ctx;
    private final Logger log;

    PaperCollectors(List<String> names, ClassLoader loader, CollectorContext ctx, Logger log) {
        this.ctx = ctx;
        this.log = log;
        Set<String> ids = new HashSet<>();
        for (String name : names) {
            Collector c = load(name, loader);
            if (c != null && ids.add(c.id())) {
                entries.add(new Entry(c));
            }
        }
    }

    private Collector load(String name, ClassLoader loader) {
        try {
            Class<?> cls = Class.forName(name, true, loader);
            if (!Collector.class.isAssignableFrom(cls)) {
                log.warning("Ledger: " + name + " is not a Collector, skipped");
                return null;
            }
            return (Collector) cls.getDeclaredConstructor().newInstance();
        } catch (ClassNotFoundException e) {
            return null;
        } catch (Throwable t) {
            log.warning("Ledger: cannot load collector " + name + ": " + t.getClass().getSimpleName());
            return null;
        }
    }

    /** Starts the collectors the config wants and stops the ones it no longer wants. Never throws. */
    synchronized void apply(LedgerConfig config) {
        for (Entry e : entries) {
            boolean want = !e.failed && config.collectorEnabled(e.collector.id());
            if (want && !e.running) {
                start(e);
            } else if (!want && e.running) {
                stop(e);
            }
        }
    }

    /** Stops every running collector, last started first. Never throws. */
    synchronized void stopAll() {
        for (int i = entries.size() - 1; i >= 0; i--) {
            if (entries.get(i).running) {
                stop(entries.get(i));
            }
        }
    }

    synchronized List<String> runningIds() {
        List<String> out = new ArrayList<>();
        for (Entry e : entries) {
            if (e.running) {
                out.add(e.collector.id());
            }
        }
        return out;
    }

    synchronized int loadedCount() {
        return entries.size();
    }

    private void start(Entry e) {
        try {
            e.collector.start(ctx);
            e.running = true;
        } catch (Throwable t) {
            e.failed = true;
            log.warning("Ledger collector " + e.collector.id() + " failed to start and is disabled: "
                    + t.getClass().getSimpleName());
            quietStop(e);
        }
    }

    private void stop(Entry e) {
        e.running = false;
        try {
            e.collector.stop();
        } catch (Throwable t) {
            log.warning("Ledger collector " + e.collector.id() + " failed to stop: " + t.getClass().getSimpleName());
        }
    }

    private void quietStop(Entry e) {
        try {
            e.collector.stop();
        } catch (Throwable ignored) {
            // the collector is already off; nothing more to do
        }
    }
}
