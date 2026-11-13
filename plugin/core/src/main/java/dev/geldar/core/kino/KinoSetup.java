package dev.geldar.core.kino;

import java.util.function.Function;
import org.bukkit.Bukkit;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Wires the Kino feed. {@link #enabled} is the kill switch: with {@code kino.enabled} false (the default) the
 * feed is registered but killed: it publishes nothing and starts no target, while the NATS connections, the
 * listeners and the timers still exist (finding 12 of round 1: registering only on first enable is left open).
 * Targets are started and stopped through the returned feed (the relay of K02 does
 * that); this class adds only MONITOR listeners and a read-only tick.
 */
public final class KinoSetup {
    private KinoSetup() {}

    public static boolean enabled(ConfigurationSection file) {
        return file.getBoolean("kino.enabled", false);
    }

    public static int radius(ConfigurationSection file) {
        return Math.max(1, Math.min(8, file.getInt("kino.radius_chunks", KinoFeed.DEFAULT_RADIUS_CHUNKS)));
    }

    /** The config reload hook: applies {@code kino.enabled} to a running feed. */
    public static void reload(KinoFeed feed, ConfigurationSection file) {
        feed.setEnabled(enabled(file));
    }

    public static KinoFeed register(
            JavaPlugin plugin, ConfigurationSection file, String natsUrl, String shard, Function<String, String> env) {
        NatsKinoSink sink = new NatsKinoSink(natsUrl, shard, env, plugin.getLogger());
        KinoFeed[] holder = new KinoFeed[1];
        KinoFeed feed = new KinoFeed(new BukkitKinoWorld(plugin.getServer(), Bukkit.getWorlds().get(0),
                name -> holder[0] != null && holder[0].isTarget(name)), sink, radius(file));
        holder[0] = feed;
        plugin.getServer().getPluginManager().registerEvents(new KinoBlockListener(feed), plugin);
        plugin.getServer().getScheduler().runTaskTimer(plugin, feed::tick, 20L, 20L);
        plugin.getServer().getScheduler().runTaskTimer(plugin, feed::pump, 1L, 1L);
        // Glass asks for targets over NATS; the commands are applied here on the server thread.
        KinoControl control = new KinoControl(feed, System::currentTimeMillis);
        new NatsKinoControl(natsUrl, shard, env, plugin.getLogger(), control);
        plugin.getServer().getScheduler().runTaskTimer(plugin, control::drain, 10L, 10L);
        plugin.getLogger().info("Kino feed enabled: radius " + radius(file) + " chunks");
        return feed;
    }
}