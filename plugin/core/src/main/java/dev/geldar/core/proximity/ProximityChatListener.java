package dev.geldar.core.proximity;

import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.audience.Audience;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Speech reaches only the players within {@link ProximityRule#HEARING_RADIUS_BLOCKS} of the speaker (spec 5.8). Far
 * players are removed from the chat event's viewers. The message is not cancelled or rewritten, so the event export
 * and the Body's say echo are unchanged, the speaker keeps their own line, and the console (not a player) still
 * records every line in the server log.
 */
public final class ProximityChatListener implements Listener {
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Player speaker = event.getPlayer();
        Location from = speaker.getLocation();
        event.viewers().removeIf(audience -> isFarPlayer(audience, speaker, from));
    }

    private static boolean isFarPlayer(Audience audience, Player speaker, Location from) {
        if (!(audience instanceof Player listener) || listener == speaker) {
            return false;
        }
        return !Hearing.between(from, listener.getLocation());
    }
}
