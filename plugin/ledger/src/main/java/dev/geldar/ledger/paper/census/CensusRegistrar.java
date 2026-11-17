package dev.geldar.ledger.paper.census;

import org.bukkit.event.Event;
import org.bukkit.plugin.EventExecutor;

/** Where the census attaches one executor per event class; the Paper implementation is {@link PaperCensusRegistrar}. */
public interface CensusRegistrar {
    /** Registers one executor for one class. May throw; the caller skips and counts the class. */
    void register(Class<? extends Event> type, EventExecutor executor);

    /** Removes everything registered through this registrar. Idempotent, never throws. */
    void unregisterAll();
}
