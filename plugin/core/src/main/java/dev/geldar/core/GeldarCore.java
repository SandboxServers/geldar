package dev.geldar.core;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
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
    /** Written while the plugin is enabled; the Paper healthcheck in compose/phase0.yml reads it. */
    static final Path READY_FILE = Path.of("/tmp/geldar-core.ready");

    private EventPublisher publisher;
    private volatile EventExporter tpsExporter;
    private ScheduledExecutorService tpsTimer;
    private ReadyMarker readyMarker;

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
        CoreConfig config = CoreConfig.load(getConfig(), System::getenv, getLogger()::warning);
        publisher = new NatsEventPublisher(config.natsUrl(), config.queueCapacity(), getLogger());
        EventExporter exporter = new EventExporter(
                publisher, config.shard(), GeldarCore::overworldTick, Instant::now, getLogger());
        tpsExporter = exporter;

        for (Listener listener : listeners(exporter, getLogger(), config.grantRecipesOnJoin())) {
            getServer().getPluginManager().registerEvents(listener, this);
            if (listener instanceof GhostListener ghost) {
                getServer().getMessenger().registerIncomingPluginChannel(this, GhostListener.CHANNEL, ghost);
            }
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
        // Last of the enable steps: the healthcheck passes only once the command block and export are wired.
        ReadyMarker marker = ReadyMarker.forThisProcess(READY_FILE);
        try {
            marker.write();
        } catch (IOException e) {
            throw new IllegalStateException("cannot write " + READY_FILE, e);
        }
        readyMarker = marker;
        getLogger().info("Geldar-Core enabled for shard " + config.shard());
    }

    /**
     * Every listener the plugin registers, in registration order. The recipe grant is registered only when
     * {@code grantRecipesOnJoin} is set (decision 0048: recipes unlock through play).
     */
    static List<Listener> listeners(EventExporter exporter, Logger log, boolean grantRecipesOnJoin) {
        List<Listener> all = new ArrayList<>();
        all.add(exporter);
        if (grantRecipesOnJoin) {
            all.add(new RecipeGrantListener(log));
        }
        all.add(new CommandBlockListener(log));
        all.add(new GhostListener(log));
        return List.copyOf(all);
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
        if (readyMarker != null) {
            try {
                readyMarker.remove();
            } catch (IOException e) {
                getLogger().warning("cannot remove " + READY_FILE + ": " + e.getMessage());
            }
        }
    }

    private static long overworldTick() {
        World world = Bukkit.getWorlds().get(0);
        return Math.max(0, world.getFullTime());
    }
}
