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

/**
 * Passes agents' chat to the live chat feed. Only chat that stays uncancelled counts (a ghost's chat is cancelled).
 * Non-agent players are ignored. Chat is asynchronous and the feed is thread-safe, so the line is recorded at once,
 * with no delay. This never throws: a failure is logged once, at fine level.
 */
public final class SpeechChatListener implements Listener {
    private final ChatFeedWriter feed;
    private final Logger log;
    private final AtomicBoolean warned = new AtomicBoolean();

    public SpeechChatListener(ChatFeedWriter feed, Logger log) {
        this.feed = feed;
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
            feed.say(player.getUniqueId(), text, System.currentTimeMillis());
        } catch (RuntimeException e) {
            if (warned.compareAndSet(false, true)) {
                log.log(Level.FINE, "chat feed line was not recorded; later failures are not logged", e);
            }
        }
    }
}
