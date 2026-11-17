package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.paper.LedgerPlugin;
import java.util.List;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Curated structured events (PT-07a). OPT-IN: unless {@code collector.curated.enabled=true} is set explicitly it registers
 * nothing. Starts every family that exists, each in its own try/catch (S8); {@link #stop} removes every executor (S10).
 */
public final class CuratedCollector implements Collector {
    public static final String ID = "curated";

    /** Installs executors at MONITOR on one dedicated listener, so removing it removes exactly the curated events. */
    static final class PaperBinder implements CuratedRegistry.Binder {
        private final Listener listener = new Listener() {};

        PaperBinder() {
            // recorded for the plugin-wide removal path (S10); the listener itself has no annotated handlers
            JavaPlugin.getPlugin(LedgerPlugin.class).listeners().register(listener);
        }

        @Override
        public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignoreCancelled) {
            Bukkit.getPluginManager()
                    .registerEvent(
                            type,
                            listener,
                            EventPriority.MONITOR,
                            executor,
                            JavaPlugin.getPlugin(LedgerPlugin.class),
                            ignoreCancelled);
        }

        @Override
        public void unbindAll() {
            try {
                HandlerList.unregisterAll(listener);
            } catch (Throwable ignored) {
                // never throws into the host
            }
        }
    }

    private final Supplier<CuratedRegistry.Binder> binderFactory;
    private final Supplier<List<CuratedFamily>> families;
    private final Supplier<Logger> logger;
    private CuratedRegistry registry;
    private volatile int familiesStarted;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public CuratedCollector() {
        this(
                PaperBinder::new,
                () -> CuratedFamilies.load(CuratedCollector.class.getClassLoader()),
                () -> JavaPlugin.getPlugin(LedgerPlugin.class).getLogger());
    }

    CuratedCollector(
            Supplier<CuratedRegistry.Binder> binderFactory,
            Supplier<List<CuratedFamily>> families,
            Supplier<Logger> logger) {
        this.binderFactory = binderFactory;
        this.families = families;
        this.logger = logger;
    }

    @Override
    public String id() {
        return ID;
    }

    /** Families whose {@code register} completed in the last start. */
    public int familiesStarted() {
        return familiesStarted;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger ledger = ctx.ledger();
        if (!Boolean.TRUE.equals(ledger.config().collectorEnabled().get(ID))) {
            return;
        }
        CuratedRegistry.Binder binder = binderFactory.get();
        CuratedRegistry r = new CuratedRegistry(ledger.events(), ledger.content(), ledger.guard(ID), ctx.host(), binder);
        registry = r;
        int ok = 0;
        for (CuratedFamily f : families.get()) {
            try {
                f.register(r);
                ok++;
            } catch (Throwable t) {
                warn("Ledger curated: family " + f.getClass().getSimpleName() + " failed: " + t.getClass().getSimpleName());
            }
        }
        familiesStarted = ok;
    }

    @Override
    public synchronized void stop() {
        CuratedRegistry r = registry;
        registry = null;
        familiesStarted = 0;
        if (r != null) {
            r.unbindAll();
        }
    }

    private void warn(String msg) {
        try {
            logger.get().warning(msg);
        } catch (Throwable ignored) {
            // logging is best effort
        }
    }
}
