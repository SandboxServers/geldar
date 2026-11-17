package dev.geldar.ledger.paper.bridge;

import dev.geldar.ledger.core.Names;
import org.bukkit.plugin.PluginManager;

/**
 * {@code geldar_bridge_coreprotect_queue}. CoreProtect exposes no queue size without compiling against it, and a
 * block lookup is heavy I/O, so this bridge reports presence only: the gauge is 0 whether or not CoreProtect is
 * enabled. {@link #present} tells the collector and the tests which it is.
 */
final class CoreProtectBridge implements Bridge {
    static final String PLUGIN = "CoreProtect";
    private volatile boolean present;

    @Override
    public String plugin() {
        return PLUGIN;
    }

    @Override
    public String metric() {
        return Names.Bridge.COREPROTECT_QUEUE;
    }

    @Override
    public String description() {
        return "CoreProtect queue size (presence only, always 0)";
    }

    @Override
    public void probe(PluginManager manager) {
        present = Bridge.enabled(manager, PLUGIN) != null;
    }

    @Override
    public void scan() {
        // presence only: no file is read
    }

    @Override
    public void clear() {
        present = false;
    }

    boolean present() {
        return present;
    }

    @Override
    public long value() {
        return 0;
    }
}
