package dev.geldar.core.speech;

import dev.geldar.core.EventEnvelope;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;

/**
 * Passes agents' chat to the speech bubbles. Only chat that stays uncancelled counts (a ghost's chat is cancelled).
 * Non-agent players are ignored. Chat is asynchronous, so the bubble is shown on the server thread. This never
 * throws: a failure is logged once, at fine level.
 */
public final class SpeechChatListener implements Listener {
    private final Plugin plugin;
    private final SpeechBubbles bubbles;
    private final Logger log;
    private final AtomicBoolean warned = new AtomicBoolean();

    public SpeechChatListener(Plugin plugin, SpeechBubbles bubbles, Logger log) {
        this.plugin = plugin;
        this.bubbles = bubbles;
        this.log = log;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        try {
            Player player = event.getPlayer();
            if (!EventEnvelope.isLifeId(player.getName())) {
                return;
            }
            String text = PlainTextComponentSerializer.plainText().serialize(event.message());
            long now = System.currentTimeMillis();
            plugin.getServer().getScheduler().runTask(plugin, () -> bubbles.say(player, text, now));
        } catch (RuntimeException e) {
            if (warned.compareAndSet(false, true)) {
                log.log(Level.FINE, "speech bubble chat was not passed on; later failures are not logged", e);
            }
        }
    }
}
