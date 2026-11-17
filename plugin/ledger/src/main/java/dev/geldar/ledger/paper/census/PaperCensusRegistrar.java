package dev.geldar.ledger.paper.census;

import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * Registers census executors at {@link EventPriority#MONITOR} with {@code ignoreCancelled=false} (the census must see
 * cancelled events). All registrations share ONE dedicated {@link Listener}, so {@link #unregisterAll} removes exactly
 * the census and nothing of the other collectors (S10).
 */
public final class PaperCensusRegistrar implements CensusRegistrar {
    private final PluginManager manager;
    private final Plugin plugin;
    private final Listener listener = new Listener() {};

    public PaperCensusRegistrar(PluginManager manager, Plugin plugin) {
        this.manager = manager;
        this.plugin = plugin;
    }

    @Override
    public void register(Class<? extends Event> type, EventExecutor executor) {
        manager.registerEvent(type, listener, EventPriority.MONITOR, executor, plugin, false);
    }

    @Override
    public void unregisterAll() {
        try {
            HandlerList.unregisterAll(listener);
        } catch (Throwable ignored) {
            // never throws into the host
        }
    }
}
