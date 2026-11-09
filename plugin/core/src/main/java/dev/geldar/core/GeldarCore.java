package dev.geldar.core;

import java.time.Instant;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;

/** Geldar-Core plugin entry point: wires config, the NATS publisher, exporter and listeners. */
public final class GeldarCore extends JavaPlugin {
    private EventPublisher publisher;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        CoreConfig config = CoreConfig.load(getConfig(), System::getenv);
        publisher = new NatsEventPublisher(config.natsUrl(), config.queueCapacity(), getLogger());
        EventExporter exporter = new EventExporter(
                publisher, config.shard(), GeldarCore::overworldTick, Instant::now, getLogger());

        getServer().getPluginManager().registerEvents(exporter, this);
        getServer().getPluginManager().registerEvents(new RecipeGrantListener(), this);
        getServer().getPluginManager().registerEvents(new CommandBlockListener(getLogger()), this);

        long period = config.tpsIntervalSeconds() * 20L;
        getServer().getScheduler().runTaskTimer(this,
                () -> exporter.exportTps(Bukkit.getTPS()[0], Bukkit.getOnlinePlayers().size()), period, period);
        getLogger().info("Geldar-Core enabled for shard " + config.shard());
    }

    @Override
    public void onDisable() {
        if (publisher != null) {
            publisher.close();
        }
    }

    private static long overworldTick() {
        World world = Bukkit.getWorlds().get(0);
        return Math.max(0, world.getFullTime());
    }
}