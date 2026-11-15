package dev.geldar.core.speech;

import de.bluecolored.bluemap.api.BlueMapAPI;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/**
 * Turns on the live chat feed (decision 0310) when BlueMap is enabled: a chat listener and the periodic async writer
 * of the feed file into the BlueMap web root. It replaces the speech bubbles (decision 0197). Without BlueMap nothing
 * is registered. {@link #register} never throws; a missing BlueMap class or any other failure leaves the feature off
 * and logs why.
 */
public final class SpeechSetup {
    /** How often the feed file is written if it changed, in ticks (one second). */
    static final long FLUSH_TICKS = 20L;

    private SpeechSetup() {
    }

    public static void register(Plugin plugin) {
        Logger log = plugin.getLogger();
        try {
            if (!Bukkit.getPluginManager().isPluginEnabled("BlueMap")) {
                log.info("BlueMap is not enabled; the chat feed is off");
                return;
            }
            ChatFeedWriter feed = new ChatFeedWriter(log);
            BlueMapAPI.onEnable(feed::attach);
            BlueMapAPI.onDisable(api -> feed.detach());
            plugin.getServer().getPluginManager().registerEvents(new SpeechChatListener(feed, log), plugin);
            plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, feed::flushIfDirty,
                    FLUSH_TICKS, FLUSH_TICKS);
        } catch (LinkageError e) {
            log.warning("BlueMap API is not on the classpath; the chat feed is off");
        } catch (RuntimeException e) {
            log.warning("chat feed is off: " + e.getClass().getSimpleName());
        }
    }
}
