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
import dev.geldar.ledger.core.LedgerBootstrap;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.OtelLedger;
import dev.geldar.ledger.core.Severity;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.logging.Logger;
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
 * defaults.
 *
 * <p>Ledger lifecycle (PT-03o): the plugin runs a no-op ledger until a config is loaded AND says {@code enabled=true}
 * (the agent ships disabled). Then it builds the real {@code OtelLedger} through {@code LedgerBootstrap} on the main
 * thread (no file IO there; a throwing build keeps the no-op ledger and logs one line). A later reload with
 * {@code enabled=true} calls {@code reload}; {@code enabled=false} stops collectors and listeners, swaps back to the
 * no-op ledger and closes the real one on an async thread (close can block up to a second, so never on the main
 * thread). {@link #onDisable} closes last, synchronously (the scheduler no longer takes tasks) and bounded.
 */
public final class LedgerPlugin extends JavaPlugin {
    static final String CONFIG_FILE = "ledger.properties";

    /** Builds the placeholder (no-op) ledger from a live config view; null means the built-in one. Set by tests. */
    Function<Supplier<LedgerConfig>, Ledger> coreFactory;

    /** A real ledger plus the two lifecycle hooks the shell needs. */
    record Built(Ledger ledger, Consumer<LedgerConfig> reload, Runnable close) {}

    /** Builds the real ledger. Set by tests; null means {@link LedgerBootstrap} over the OpenTelemetry API. */
    interface LedgerFactory {
        Built create(LedgerConfig config, HostInfo host, Logger log);
    }

    LedgerFactory ledgerFactory;

    /** The collector classes to look up; null means {@link PaperCollectors#NAMES}. Set by tests. */
    List<String> collectorNames;

    private PaperHostScheduler scheduler;
    private ListenerRegistry listeners;
    private PaperCollectors collectors;
    private ConfigWatcher watcher;
    private HostInfo hostInfo;
    // static: the tests allocate the plugin without running field initializers; a lock shared by instances is harmless
    private static final Object LEDGER_LOCK = new Object();
    private Ledger noopLedger;
    private volatile Ledger currentLedger;
    private Built real;
    private boolean buildWarned;

    /** Used by the server. */
    public LedgerPlugin() {
        super();
    }


    @Override
    public void onEnable() {
        try {
            scheduler = new PaperHostScheduler(this, getServer().getScheduler(), getLogger());
            HostInfo host = new PaperHostInfo(getServer());
            hostInfo = host;
            listeners = new ListenerRegistry(this, getServer().getPluginManager(), getLogger());
            Path file = getDataFolder().toPath().resolve(CONFIG_FILE);
            // The watcher is built first so that the ledger can read its current snapshot.
            ConfigWatcher w = new ConfigWatcher(file, scheduler, this::onConfig, getLogger());
            Function<Supplier<LedgerConfig>, Ledger> factory = coreFactory != null ? coreFactory : NoopLedger::new;
            noopLedger = factory.apply(w::current);
            currentLedger = noopLedger;
            collectors = new PaperCollectors(collectorNames != null ? collectorNames : PaperCollectors.NAMES, getClass().getClassLoader(), new Ctx(() -> currentLedger, scheduler, host), getLogger());
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
        guard(this::closeRealNow);
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
                ensureLedger(config);
                collectors.apply(config);
            } else {
                collectors.stopAll();
                listeners.unregisterAll();
                swapToNoop();
            }
        });
    }

    /** Builds the real ledger on the first enabled config, else reloads it. Never throws. */
    private void ensureLedger(LedgerConfig config) {
        synchronized (LEDGER_LOCK) {
            if (real != null) {
                try {
                    real.reload().accept(config);
                } catch (Throwable t) {
                    getLogger().warning("Ledger reload failed: " + t.getClass().getSimpleName());
                }
                return;
            }
            try {
                LedgerFactory f = ledgerFactory != null ? ledgerFactory : LedgerPlugin::bootstrap;
                Built b = f.create(config, hostInfo, getLogger());
                real = b;
                currentLedger = b.ledger();
            } catch (Throwable t) {
                real = null;
                currentLedger = noopLedger;
                if (!buildWarned) {
                    buildWarned = true;
                    getLogger().warning("Ledger could not build the OpenTelemetry ledger, running without it: "
                            + t.getClass().getSimpleName());
                }
            }
        }
    }

    private static Built bootstrap(LedgerConfig config, HostInfo host, Logger log) {
        OtelLedger l = LedgerBootstrap.create(config, host, log);
        return new Built(l, l::reload, l::close);
    }

    /** Swaps to the no-op ledger now (collectors are already stopped) and closes the old one off the main thread. */
    private void swapToNoop() {
        Built old;
        synchronized (LEDGER_LOCK) {
            old = real;
            real = null;
            currentLedger = noopLedger;
        }
        if (old == null) {
            return;
        }
        try {
            getServer().getScheduler().runTaskAsynchronously(this, () -> closeQuietly(old));
        } catch (Throwable t) {
            getLogger().warning("Ledger could not schedule its close: " + t.getClass().getSimpleName());
        }
    }

    /** onDisable path: the scheduler no longer takes tasks, so the (bounded) close runs here. */
    private void closeRealNow() {
        Built old;
        synchronized (LEDGER_LOCK) {
            old = real;
            real = null;
            currentLedger = noopLedger;
        }
        if (old != null) {
            closeQuietly(old);
        }
    }

    private void closeQuietly(Built b) {
        try {
            b.close().run();
        } catch (Throwable t) {
            getLogger().warning("Ledger close failed: " + t.getClass().getSimpleName());
        }
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

    private record Ctx(Supplier<Ledger> source, HostScheduler scheduler, HostInfo host) implements CollectorContext {
        @Override
        public Ledger ledger() {
            return source.get();
        }
    }

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
