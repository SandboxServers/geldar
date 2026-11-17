package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.container.CgroupCollector;
import dev.geldar.ledger.core.disk.DiskArea;
import dev.geldar.ledger.core.disk.DiskCollector;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

/**
 * The collectors the plugin knows by name. A class that is absent is skipped with one INFO line per start (its card has not landed);
 * collectors are built once, on the first enabled config (paths come from it), and then started or stopped by {@link #apply} from the config. A collector whose
 * {@code start} throws is switched off for the rest of the run and the others are not affected (S8).
 */
final class PaperCollectors {
    /** Every planned collector class (PT-04b to PT-10b), listed once. Missing classes are skipped. */
    static final String CGROUP = "dev.geldar.ledger.core.container.CgroupCollector";
    static final String DISK = "dev.geldar.ledger.core.disk.DiskCollector";

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
            CGROUP,
            DISK);

    private static final class Entry {
        final Collector collector;
        boolean running;
        boolean failed;

        Entry(Collector collector) {
            this.collector = collector;
        }
    }

    /** Builds one collector for a name from the first enabled config. Throws {@link ClassNotFoundException} when the class does not exist yet and {@link Skipped} when it has nothing to do. */
    public interface CollectorFactory {
        Collector create(String id, LedgerConfig config) throws Exception;
    }

    /** A collector that is configured out of existence (for example a disk collector with no area path). */
    public static final class Skipped extends Exception {
        private static final long serialVersionUID = 1L;

        public Skipped(String message) {
            super(message, null, false, false);
        }
    }

    /** Reflection for the Paper-side collectors; explicit construction for the two that take configured paths. */
    static final class DefaultFactory implements CollectorFactory {
        private final ClassLoader loader;

        DefaultFactory(ClassLoader loader) {
            this.loader = loader;
        }

        @Override
        public Collector create(String name, LedgerConfig config) throws Exception {
            if (name.equals(DISK)) {
                return disk(config);
            }
            if (name.equals(CGROUP)) {
                return new CgroupCollector(Path.of(config.cgroupRoot()));
            }
            Class<?> cls = Class.forName(name, true, loader);
            if (!Collector.class.isAssignableFrom(cls)) {
                throw new IllegalStateException("not a Collector");
            }
            return (Collector) cls.getDeclaredConstructor().newInstance();
        }

        private static Collector disk(LedgerConfig config) throws Skipped {
            Map<DiskArea, Path> roots = new EnumMap<>(DiskArea.class);
            for (DiskArea a : DiskArea.values()) {
                String configured = config.diskAreaPath(a.attr());
                if (configured != null) {
                    roots.put(a, Path.of(configured).toAbsolutePath().normalize());
                }
            }
            if (roots.isEmpty()) {
                throw new Skipped("no disk.area.<name>.path is configured, disk collector not started");
            }
            return new DiskCollector(roots);
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private final List<String> skipped = new ArrayList<>();
    private final List<String> names;
    private final CollectorFactory factory;
    private final CollectorContext ctx;
    private final Logger log;
    private boolean built;

    PaperCollectors(List<String> names, ClassLoader loader, CollectorContext ctx, Logger log) {
        this(names, new DefaultFactory(loader), ctx, log);
    }

    PaperCollectors(List<String> names, CollectorFactory factory, CollectorContext ctx, Logger log) {
        this.names = List.copyOf(names);
        this.factory = factory;
        this.ctx = ctx;
        this.log = log;
    }

    /** Builds the collectors once, from the first config that wants them; later path changes need a restart. */
    private void build(LedgerConfig config) {
        built = true;
        Set<String> ids = new HashSet<>();
        List<String> absent = new ArrayList<>();
        for (String name : names) {
            try {
                Collector c = factory.create(name, config);
                if (c != null && ids.add(c.id())) {
                    entries.add(new Entry(c));
                }
            } catch (ClassNotFoundException | NoClassDefFoundError e) {
                absent.add(name);
            } catch (Skipped s) {
                skipped.add(name);
                log.info("Ledger: " + s.getMessage());
            } catch (Throwable t) {
                skipped.add(name);
                log.warning("Ledger: cannot build collector " + name + ", disabled: " + t.getClass().getSimpleName());
            }
        }
        skipped.addAll(absent);
        if (!absent.isEmpty()) {
            log.info("Ledger: " + absent.size() + " collectors are not built yet and are skipped");
        }
    }
    /** Starts the collectors the config wants and stops the ones it no longer wants. Never throws. */
    synchronized void apply(LedgerConfig config) {
        if (!built) {
            build(config);
        }
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

    /** Names that were not built (missing class, nothing configured, or a construction failure), in order. */
    synchronized List<String> skippedNames() {
        return List.copyOf(skipped);
    }

    /** Ids of every built collector, running or not. */
    synchronized List<String> builtIds() {
        List<String> out = new ArrayList<>();
        for (Entry e : entries) {
            out.add(e.collector.id());
        }
        return out;
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
