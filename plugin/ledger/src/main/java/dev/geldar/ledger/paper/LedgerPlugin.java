package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ConfigWatcher;
import dev.geldar.ledger.core.ContentLog;
import dev.geldar.ledger.core.Counter;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.Histogram;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Severity;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.LongSupplier;
import java.util.function.DoubleSupplier;
import java.util.function.Supplier;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The Ledger plugin: the thin Paper shell over {@code ledger-core}. It never throws into the host: a failed enable
 * disables this plugin only (never the server, S8), every lifecycle method is wrapped, and it touches nothing an agent
 * can see (no chat, no signs, no world changes, no commands, no permissions, S9).
 *
 * <p>The config lives in {@code <dataFolder>/ledger.properties}; nothing is created on disk and a missing file means
 * defaults. Until the OpenTelemetry binding (PT-03g) is wired, the core is a no-op ledger.
 */
public final class LedgerPlugin extends JavaPlugin {
    static final String CONFIG_FILE = "ledger.properties";

    /** Builds the core ledger from a live config view; null means the no-op ledger until PT-03g. Set by tests. */
    Function<Supplier<LedgerConfig>, Ledger> coreFactory;

    /** The collector classes to look up; null means {@link PaperCollectors#NAMES}. Set by tests. */
    List<String> collectorNames;

    private PaperHostScheduler scheduler;
    private ListenerRegistry listeners;
    private PaperCollectors collectors;
    private ConfigWatcher watcher;

    /** Used by the server. */
    public LedgerPlugin() {
        super();
    }


    @Override
    public void onEnable() {
        try {
            scheduler = new PaperHostScheduler(this, getServer().getScheduler(), getLogger());
            HostInfo host = new PaperHostInfo(getServer());
            listeners = new ListenerRegistry(this, getServer().getPluginManager(), getLogger());
            Path file = getDataFolder().toPath().resolve(CONFIG_FILE);
            // The watcher is built first so that the ledger can read its current snapshot.
            ConfigWatcher w = new ConfigWatcher(file, scheduler, this::onConfig, getLogger());
            Function<Supplier<LedgerConfig>, Ledger> factory = coreFactory != null ? coreFactory : NoopLedger::new;
            Ledger ledger = factory.apply(w::current);
            collectors = new PaperCollectors(collectorNames != null ? collectorNames : PaperCollectors.NAMES, getClass().getClassLoader(), new Ctx(ledger, scheduler, host), getLogger());
            watcher = w;
            w.start(); // the first poll (on an async thread) starts the collectors
        } catch (Throwable t) {
            getLogger().severe("Ledger failed to enable and is switching itself off: " + t.getClass().getSimpleName());
            disableSelf();
        }
    }

    @Override
    public void onDisable() {
        guard(() -> {
            if (watcher != null) {
                watcher.stop();
            }
        });
        guard(() -> {
            if (collectors != null) {
                collectors.stopAll();
            }
        });
        guard(() -> {
            if (listeners != null) {
                listeners.unregisterAll();
            }
        });
    }

    /** The registry collectors use to register Bukkit listeners; null before enable. */
    public ListenerRegistry listeners() {
        return listeners;
    }

    PaperCollectors collectors() {
        return collectors;
    }

    /** ConfigWatcher callback; runs on an async thread. Hops to the main thread before touching collectors. */
    private void onConfig(LedgerConfig config) {
        try {
            getServer().getScheduler().runTask(this, () -> applyConfig(config));
        } catch (Throwable t) {
            getLogger().warning("Ledger could not apply a config change: " + t.getClass().getSimpleName());
        }
    }

    void applyConfig(LedgerConfig config) {
        guard(() -> {
            if (config.enabled()) {
                collectors.apply(config);
            } else {
                collectors.stopAll();
                listeners.unregisterAll();
            }
        });
    }

    private void disableSelf() {
        try {
            getServer().getPluginManager().disablePlugin(this);
        } catch (Throwable t) {
            getLogger().severe("Ledger could not disable itself: " + t.getClass().getSimpleName());
        }
    }

    private void guard(Runnable r) {
        try {
            r.run();
        } catch (Throwable t) {
            getLogger().warning("Ledger error: " + t.getClass().getSimpleName());
        }
    }

    private record Ctx(Ledger ledger, HostScheduler scheduler, HostInfo host) implements CollectorContext {}

    /** The core until the OpenTelemetry binding exists: accepts everything, records nothing. */
    private static final class NoopLedger implements Ledger {
        private static final BoundCounter COUNTER = n -> {};
        private static final BoundHistogram HISTOGRAM = v -> {};
        private static final EventLog EVENTS = new EventLog() {
            @Override
            public int register(String eventName, Severity s, int ratePerSecond, String... fieldNames) {
                return 0;
            }

            @Override
            public void record(int id, long a, long b, long c, String s1, String s2, String s3) {}

            @Override
            public void emitMap(String eventName, Severity s, Map<String, Object> attrs) {}
        };
        private static final ContentLog CONTENT = new ContentLog() {
            @Override
            public int register(String eventName, String... fieldNames) {
                return 0;
            }

            @Override
            public void record(int id, String text, String s1, String s2, String s3) {}
        };
        private static final CollectorGuard GUARD = new CollectorGuard() {
            @Override
            public boolean allowed() {
                return true;
            }

            @Override
            public long begin() {
                return 0;
            }

            @Override
            public void end(long token) {}
        };

        private final Supplier<LedgerConfig> config;

        NoopLedger(Supplier<LedgerConfig> config) {
            this.config = config;
        }

        @Override
        public Counter counter(String name, String unit, String description, String... attrKeys) {
            return values -> COUNTER;
        }

        @Override
        public Histogram histogram(String name, String unit, String description, double[] bounds, String... attrKeys) {
            return values -> HISTOGRAM;
        }

        @Override
        public void gaugeLong(String name, String unit, String description, LongSupplier reader, String... attrKeys) {}

        @Override
        public void gaugeDouble(String name, String unit, String description, DoubleSupplier reader, String... attrKeys) {}

        @Override
        public EventLog events() {
            return EVENTS;
        }

        @Override
        public ContentLog content() {
            return CONTENT;
        }

        @Override
        public CollectorGuard guard(String collectorId) {
            return GUARD;
        }

        @Override
        public LedgerConfig config() {
            return config.get();
        }
    }
}
