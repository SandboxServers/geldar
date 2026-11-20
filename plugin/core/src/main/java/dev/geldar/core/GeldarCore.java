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
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.plugin.messaging.Messenger;

/** Geldar-Core plugin entry point: wires config, the NATS publisher, exporter and listeners. */
public final class GeldarCore extends JavaPlugin {
    /** Written while the plugin is enabled; the Paper healthcheck in compose/phase0.yml reads it. */
    static final Path READY_FILE = Path.of("/tmp/geldar-core.ready");

    private EventPublisher publisher;
    private volatile EventExporter tpsExporter;
    private ScheduledExecutorService tpsTimer;
    private ReadyMarker readyMarker;
    private volatile dev.geldar.core.blockowner.BlockOwnerSetup blockOwner;
    private volatile dev.geldar.core.proximity.NatsHearingSink hearingSink;
    private volatile AutoCloseable metrics;

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

    /** Opens the incoming {@code geldar:ghost} channel for the ghost listener; without it no signal is read. */
    static void registerChannels(Messenger messenger, Plugin plugin, List<Listener> listeners) {
        for (Listener listener : listeners) {
            if (listener instanceof GhostListener ghost) {
                messenger.registerIncomingPluginChannel(plugin, GhostListener.CHANNEL, ghost);
            }
        }
    }

    /**
     * The trace hook, or the no-op one when it cannot be built. A telemetry fault (even a LinkageError from an agent
     * bridge) never reaches {@link #enableOrStop}, which would stop the server, nor leaves the plugin disabled.
     */
    static dev.geldar.core.trace.TraceHook telemetryHook(
            java.util.function.Supplier<dev.geldar.core.trace.TraceHook> factory, Logger log) {
        try {
            dev.geldar.core.trace.TraceHook hook = factory.get();
            return hook == null ? dev.geldar.core.trace.TraceHook.NOOP : hook;
        } catch (Throwable e) {
            if (e instanceof VirtualMachineError vm) {
                throw vm;
            }
            log.warning("tracing is off: " + e.getClass().getSimpleName());
            return dev.geldar.core.trace.TraceHook.NOOP;
        }
    }

    /** Registers the core metrics; on any telemetry fault they are skipped (logged once) and null is returned. */
    static AutoCloseable telemetryMetrics(java.util.function.Supplier<AutoCloseable> register, Logger log) {
        try {
            return register.get();
        } catch (Throwable e) {
            if (e instanceof VirtualMachineError vm) {
                throw vm;
            }
            log.warning("core metrics are off: " + e.getClass().getSimpleName());
            return null;
        }
    }

    private void enable() {
        saveDefaultConfig();
        CoreConfig config = CoreConfig.load(getConfig(), System::getenv, getLogger()::warning);
        // One trace hook for every sender; with no OpenTelemetry agent it injects nothing and enters no scope.
        dev.geldar.core.trace.TraceHook trace = telemetryHook(dev.geldar.core.trace.OtelTraceHook::new, getLogger());
        NatsEventPublisher nats = new NatsEventPublisher(config.natsUrl(), config.queueCapacity(), getLogger(), trace);
        publisher = nats;
        EventExporter exporter = new EventExporter(
                publisher, config.shard(), GeldarCore::overworldTick, Instant::now, getLogger());
        tpsExporter = exporter;

        List<Listener> registered = listeners(exporter, getLogger(), config.grantRecipesOnJoin());
        for (Listener listener : registered) {
            getServer().getPluginManager().registerEvents(listener, this);
        }
        registerChannels(getServer().getMessenger(), this, registered);

        if (config.lakitu().enabled()) {
            dev.geldar.core.lakitu.LakituFeed.register(this, config.lakitu());
        }
        // Kino is registered always and applied from kino.enabled (default false: the feed starts killed, so it
        // publishes nothing). The config file is re-read every 5 s, so flipping kino.enabled needs no restart.
        java.util.concurrent.atomic.AtomicReference<dev.geldar.core.kino.NatsKinoSink> kinoSink =
                new java.util.concurrent.atomic.AtomicReference<>();
        dev.geldar.core.kino.KinoFeed kino = dev.geldar.core.kino.KinoSetup.register(
                this, getConfig(), config.natsUrl(), config.shard(), System::getenv, kinoSink::set);
        dev.geldar.core.kino.KinoSetup.reload(kino, getConfig());
        // The maintenance notice broadcast (CD-1c): maintenance.broadcast, applied by the same 5 s reload.
        dev.geldar.core.maintenance.MaintenanceNotices maintenance = dev.geldar.core.maintenance.MaintenanceSetup
                .register(this, getConfig(), config.natsUrl(), config.shard(), System::getenv, trace);
        // Block ownership (CoreProtect-backed owner queries): blockowner.* is applied by the same 5 s reload.
        dev.geldar.core.blockowner.BlockOwnerSetup owners = dev.geldar.core.blockowner.BlockOwnerSetup.register(
                this, config.natsUrl(), config.shard(), System::getenv, trace);
        blockOwner = owners;
        // Combat facts (AN-50a): the same provenance switch as the break and take listeners, ticked every server tick.
        CombatFactListener combat = owners.combatFacts(exporter, Bukkit::getCurrentTick);
        getServer().getPluginManager().registerEvents(combat, this);
        getServer().getScheduler().runTaskTimer(this, combat::tick, 1L, 1L);
        // Gravestones (no loot): a marker block and sign where an agent character dies. Read once at enable. Registered
        // after block ownership, because each gravestone is recorded as owned by the system through its recorder.
        getServer().getPluginManager().registerEvents(new GravestoneListener(
                getConfig().getBoolean("gravestones.enabled", true),
                Math.max(1, getConfig().getInt("gravestones.max_per_chunk", 4)), getLogger(), owners.placements()),
                this);
        getCommand(GraveBackfillCommand.NAME).setExecutor(new GraveBackfillCommand(this, owners.placements(),
                owners.source()));
        // Proximity (spec 5.8, decision 0199): chat is gated on effective distance; a muffled voice sends a notice.
        dev.geldar.core.proximity.MuffleSettings muffle = dev.geldar.core.proximity.MuffleSettings.clamped(
                getConfig().getDouble("chat.muffle.margin", dev.geldar.core.proximity.MuffleConfig.MARGIN),
                getConfig().getDouble("chat.muffle.sealed_penalty", dev.geldar.core.proximity.MuffleConfig.SEALED_PENALTY),
                getConfig().getInt("chat.muffle.per_line_cap", dev.geldar.core.proximity.MuffleConfig.PER_LINE_READ_CAP),
                getConfig().getInt("chat.muffle.per_ray_cap", dev.geldar.core.proximity.MuffleConfig.PER_RAY_READ_CAP),
                getConfig().getBoolean("chat.muffle.bench_log", false),
                getLogger()::warning);
        hearingSink = new dev.geldar.core.proximity.NatsHearingSink(
                config.natsUrl(), config.shard(), System::getenv, getLogger(), trace);
        metrics = telemetryMetrics(
                () -> dev.geldar.core.trace.CoreMetrics.register(nats, hearingSink, kinoSink.get(), owners.queryService()),
                getLogger());
        getServer().getPluginManager().registerEvents(new dev.geldar.core.proximity.ProximityChatListener(
                dev.geldar.core.proximity.ChatHop.bukkit(this, getLogger()::warning),
                org.bukkit.Bukkit::getCurrentTick,
                dev.geldar.core.proximity.PaperBlockReader::new,
                new dev.geldar.core.proximity.ChatHearing(muffle, getLogger()::info),
                hearingSink), this);
        getServer().getPluginManager().registerEvents(new dev.geldar.core.proximity.ProximityDeathListener(
                () -> Bukkit.getOnlinePlayers(), line -> Bukkit.getConsoleSender().sendMessage(line), getLogger()), this);
        // BlueMap skin provider (GX-07): never returns an empty skin, so BlueMap keeps the agents' head files.
        try {
            dev.geldar.core.skins.AgentSkinSetup.register(this, System::getenv);
        } catch (LinkageError | RuntimeException e) {
            getLogger().warning("agent skins are not set: " + e.getClass().getSimpleName());
        }
        // The live chat feed for the BlueMap panel (decision 0310): agents' chat only, off unless BlueMap is enabled.
        try {
            dev.geldar.core.speech.SpeechSetup.register(this);
        } catch (LinkageError | RuntimeException e) {
            getLogger().warning("chat feed is off: " + e.getClass().getSimpleName());
        }
        getServer().getScheduler().runTaskTimer(this, () -> {
            reloadConfig();
            dev.geldar.core.kino.KinoSetup.reload(kino, getConfig());
            dev.geldar.core.maintenance.MaintenanceSetup.reload(maintenance, getConfig());
            owners.reload(getConfig());
        }, 100L, 100L);

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
        AutoCloseable registered = metrics;
        if (registered != null) {
            try {
                registered.close();
            } catch (Exception | LinkageError e) {
                getLogger().warning("core metrics did not close: " + e.getClass().getSimpleName());
            }
        }
        if (tpsTimer != null) {
            tpsTimer.shutdownNow();
        }
        if (blockOwner != null) {
            blockOwner.close();
        }
        if (hearingSink != null) {
            hearingSink.close();
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
