package dev.geldar.core;

import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
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

    /** Log lines allowed per window; further blocked commands are counted and reported in the next window. */
    static final int MAX_LOGGED_PER_WINDOW = 10;
    static final long WINDOW_NANOS = TimeUnit.SECONDS.toNanos(10);

    private final Logger log;
    private final LongSupplier nanos;
    private long windowStart;
    private int loggedInWindow;
    private int suppressed;

    /** Creates the listener; blocked commands are logged to {@code log}. */
    public CommandBlockListener(Logger log) {
        this(log, System::nanoTime);
    }

    CommandBlockListener(Logger log, LongSupplier nanos) {
        this.log = log;
        this.nanos = nanos;
        this.windowStart = nanos.getAsLong();
    }

    /** Cancels the command. HIGHEST, so a plugin that un-cancels at a lower priority cannot let it through. */
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        event.setCancelled(true);
        if (allowLog()) {
            log.info("Blocked command from " + clip(event.getPlayer().getName()) + ": " + clip(event.getMessage()));
        }
    }

    /** At most {@link #MAX_LOGGED_PER_WINDOW} lines per window, so a spamming client cannot flood the log. */
    private synchronized boolean allowLog() {
        long now = nanos.getAsLong();
        if (now - windowStart >= WINDOW_NANOS) {
            if (suppressed > 0) {
                log.info(suppressed + " blocked commands were not logged in the last window");
            }
            windowStart = now;
            loggedInWindow = 0;
            suppressed = 0;
        }
        if (loggedInWindow >= MAX_LOGGED_PER_WINDOW) {
            suppressed++;
            return false;
        }
        loggedInWindow++;
        return true;
    }

    /** The text cut to {@link #MAX_LOGGED_CHARS} characters, control and format characters (log forging, bidi, line and paragraph separators) replaced by spaces. */
    static String clip(String message) {
        String flat = message.replaceAll("[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", " ");
        if (flat.length() <= MAX_LOGGED_CHARS) {
            return flat;
        }
        return flat.substring(0, MAX_LOGGED_CHARS) + "... (" + message.length() + " chars)";
    }
}