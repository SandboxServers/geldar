package dev.geldar.core.speech;

import de.bluecolored.bluemap.api.BlueMapAPI;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/**
 * Turns on the speech bubbles (decision 0197) when BlueMap is enabled: a chat listener, the expiry task and the
 * BlueMap marker writer. Without BlueMap nothing is registered. {@link #register} never throws; a missing BlueMap
 * class or any other failure leaves the feature off and logs why.
 */
public final class SpeechSetup {
    /** How often expired bubbles are removed, in ticks (one second). */
    static final long SWEEP_TICKS = 20L;

    private SpeechSetup() {
    }

    public static void register(Plugin plugin) {
        Logger log = plugin.getLogger();
        try {
            if (!Bukkit.getPluginManager().isPluginEnabled("BlueMap")) {
                log.info("BlueMap is not enabled; speech bubbles are off");
                return;
            }
            SpeechMarkers markers = new SpeechMarkers();
            SpeechBubbles bubbles = new SpeechBubbles(new BubbleBook(), markers, log);
            BlueMapAPI.onEnable(markers::attach);
            BlueMapAPI.onDisable(api -> markers.detach());
            plugin.getServer().getPluginManager().registerEvents(new SpeechChatListener(plugin, bubbles, log), plugin);
            plugin.getServer().getScheduler().runTaskTimer(plugin,
                    () -> bubbles.expire(System.currentTimeMillis()), SWEEP_TICKS, SWEEP_TICKS);
        } catch (LinkageError e) {
            log.warning("BlueMap API is not on the classpath; speech bubbles are off");
        } catch (RuntimeException e) {
            log.warning("speech bubbles are off: " + e.getClass().getSimpleName());
        }
    }
}
