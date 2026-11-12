package dev.geldar.core.maintenance;

import java.util.function.Function;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Wires the maintenance broadcast. {@code maintenance.broadcast} (default true) is the switch: the plugin re-reads
 * config.yml every 5 s and {@link #reload} applies it, so it can be turned off without a restart. The NATS subscriber
 * and its connection exist either way; with the switch off no line is said.
 */
public final class MaintenanceSetup {
    private MaintenanceSetup() {}

    public static boolean enabled(ConfigurationSection file) {
        return file.getBoolean("maintenance.broadcast", true);
    }

    /** The config reload hook: applies {@code maintenance.broadcast} to the running broadcaster. Server thread. */
    public static void reload(MaintenanceNotices notices, ConfigurationSection file) {
        notices.setEnabled(enabled(file));
    }

    public static MaintenanceNotices register(
            JavaPlugin plugin, ConfigurationSection file, String natsUrl, String shard, Function<String, String> env) {
        MaintenanceNotices notices = new MaintenanceNotices(
                enabled(file),
                text -> plugin.getServer().broadcastMessage(text),
                task -> plugin.getServer().getScheduler().runTask(plugin, task),
                System::currentTimeMillis,
                plugin.getLogger());
        new NatsMaintenanceSubscriber(natsUrl, shard, env, plugin.getLogger(), notices);
        plugin.getLogger().info("Maintenance notices enabled: broadcast " + enabled(file));
        return notices;
    }
}
