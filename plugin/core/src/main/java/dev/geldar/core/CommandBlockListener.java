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
    /** Longest command text written to the log; a player controls the length of the message. */
    static final int MAX_LOGGED_CHARS = 100;

    private final Logger log;

    /** Creates the listener; blocked commands are logged to {@code log}. */
    public CommandBlockListener(Logger log) {
        this.log = log;
    }

    /** Cancels the command. HIGHEST, so a plugin that un-cancels at a lower priority cannot let it through. */
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        event.setCancelled(true);
        log.info("Blocked command from " + event.getPlayer().getName() + ": " + clip(event.getMessage()));
    }

    /** The text cut to {@link #MAX_LOGGED_CHARS} characters, control characters (log forging) replaced by spaces. */
    static String clip(String message) {
        String flat = message.replaceAll("\\p{Cntrl}", " ");
        if (flat.length() <= MAX_LOGGED_CHARS) {
            return flat;
        }
        return flat.substring(0, MAX_LOGGED_CHARS) + "... (" + message.length() + " chars)";
    }
}