package dev.geldar.core.lakitu;

import org.bukkit.Bukkit;
import org.bukkit.plugin.java.JavaPlugin;

/** Wires the feed when {@code lakitu.enabled} is true. It registers read-only MONITOR listeners and nothing else. */
public final class LakituFeed {
    private LakituFeed() {}

    /** Registers the block-update listener and returns the queue the frame builder drains. */
    public static UpdateQueue register(JavaPlugin plugin, LakituConfig config) {
        UpdateQueue queue = new UpdateQueue(config.maxUpdatesPerFrame());
        plugin.getServer().getPluginManager().registerEvents(
                new BlockUpdateListener(queue, () -> Math.max(0, Bukkit.getWorlds().get(0).getFullTime())), plugin);
        plugin.getLogger().info("Lakitu feed enabled: radius " + config.radiusChunks() + " chunks, "
                + config.maxPanesPerSession() + " panes per session, " + config.frameHz() + " Hz");
        return queue;
    }
}