package dev.geldar.core;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

/** Geldar-Core plugin entry point: wires config, the NATS publisher, exporter and listeners. */
public final class GeldarCore extends JavaPlugin {
    private EventPublisher publisher;
    private volatile EventExporter tpsExporter;
    private ScheduledExecutorService tpsTimer;

    @Override
    public void onEnable() {
        enableOrStop(this::enable, this::onDisable, () -> getServer().shutdown(), getLogger());
    }

    /**
     * Runs {@code enable}; when it fails, releases what it started and stops the server. A server that runs
     * on without the command block and the export is worse than one that stops.
     */
    static void enableOrStop(Runnable enable, Runnable disable, Runnable shutdown, Logger log) {
        try {
            enable.run();
        } catch (RuntimeException e) {
            log.log(Level.SEVERE, "Geldar-Core failed to enable; stopping the server", e);
            disable.run();
            shutdown.run();
        }
    }

    private void enable() {
        saveDefaultConfig();
        CoreConfig config = CoreConfig.load(getConfig(), System::getenv);
        publisher = new NatsEventPublisher(config.natsUrl(), config.queueCapacity(), getLogger());
        EventExporter exporter = new EventExporter(
                publisher, config.shard(), GeldarCore::overworldTick, Instant::now, getLogger());
        tpsExporter = exporter;

        for (Listener listener : listeners(exporter, getLogger())) {
            getServer().getPluginManager().registerEvents(listener, this);
        }

        // A wall-clock timer: a tick-based task thins out when the server lags, which is when the figure matters.
        // The Bukkit calls hop back onto the server thread; the timer thread touches no server state.
        tpsTimer = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "geldar-tps-timer");
            t.setDaemon(true);
            return t;
        });
        tpsTimer.scheduleAtFixedRate(this::requestTpsExport, config.tpsIntervalSeconds(),
                config.tpsIntervalSeconds(), TimeUnit.SECONDS);
        getLogger().info("Geldar-Core enabled for shard " + config.shard());
    }

    /** Every listener the plugin registers, in registration order. */
    static List<Listener> listeners(EventExporter exporter, Logger log) {
        return List.of(exporter, new RecipeGrantListener(), new CommandBlockListener(log));
    }

    private void requestTpsExport() {
        try {
            getServer().getScheduler().runTask(this, () -> {
                EventExporter exporter = tpsExporter;
                if (exporter != null) {
                    exporter.exportTps(Bukkit.getTPS()[0], Bukkit.getOnlinePlayers().size());
                }
            });
        } catch (RuntimeException e) {
            // The plugin was disabled between the timer firing and the hop; nothing to export.
            getLogger().fine("server_tps skipped: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (tpsTimer != null) {
            tpsTimer.shutdownNow();
        }
        if (publisher != null) {
            publisher.close();
        }
    }

    private static long overworldTick() {
        World world = Bukkit.getWorlds().get(0);
        return Math.max(0, world.getFullTime());
    }
}