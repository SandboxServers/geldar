package dev.geldar.core;

import java.util.logging.Logger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;

/**
 * Cancels and logs every command typed by a player (Appendix F). Console and RCON do not raise this
 * event, so operators are unaffected.
 */
public final class CommandBlockListener implements Listener {
    private final Logger log;

    public CommandBlockListener(Logger log) {
        this.log = log;
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        event.setCancelled(true);
        log.info("Blocked command from " + event.getPlayer().getName() + ": " + event.getMessage());
    }
}