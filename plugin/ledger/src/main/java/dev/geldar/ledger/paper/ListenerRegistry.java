package dev.geldar.ledger.paper;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * Every Ledger listener is registered here, so that turning the plugin or the master switch off removes them all
 * (S10). Collectors register through this class, never through the plugin manager directly.
 */
public final class ListenerRegistry {
    private static final int MAX_ERROR_LOGS = 3;

    private final Plugin plugin;
    private final PluginManager manager;
    private final Logger log;
    private final List<Listener> registered = new ArrayList<>();
    private int errors;

    ListenerRegistry(Plugin plugin, PluginManager manager, Logger log) {
        this.plugin = plugin;
        this.manager = manager;
        this.log = log;
    }

    /** Registers the listener's handlers with the server. Never throws. */
    public synchronized void register(Listener listener) {
        registered.add(listener); // recorded first: a half-done registration is still removed later
        try {
            manager.registerEvents(listener, plugin);
        } catch (Throwable t) {
            logError("Ledger listener registration failed: " + t.getClass().getSimpleName());
        }
    }

    /** Removes every listener registered through this registry, newest first. Never throws. */
    public synchronized void unregisterAll() {
        for (int i = registered.size() - 1; i >= 0; i--) {
            try {
                HandlerList.unregisterAll(registered.get(i));
            } catch (Throwable t) {
                logError("Ledger listener removal failed: " + t.getClass().getSimpleName());
            }
        }
        registered.clear();
    }

    public synchronized int count() {
        return registered.size();
    }

    private void logError(String msg) {
        if (++errors <= MAX_ERROR_LOGS) {
            log.warning(msg);
        }
    }
}
