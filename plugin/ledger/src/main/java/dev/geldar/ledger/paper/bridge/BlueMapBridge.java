package dev.geldar.ledger.paper.bridge;

import dev.geldar.ledger.core.Names;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.plugin.PluginManager;

/** {@code geldar_bridge_bluemap_enabled}: 1 when BlueMap is loaded and enabled, read from the plugin manager only. */
final class BlueMapBridge implements Bridge {
    static final String PLUGIN = "BlueMap";
    private final AtomicLong enabled = new AtomicLong();

    @Override
    public String plugin() {
        return PLUGIN;
    }

    @Override
    public String metric() {
        return Names.Bridge.BLUEMAP_ENABLED;
    }

    @Override
    public String description() {
        return "1 when the BlueMap plugin is enabled";
    }

    @Override
    public void probe(PluginManager manager) {
        enabled.set(Bridge.enabled(manager, PLUGIN) != null ? 1 : 0);
    }

    @Override
    public void scan() {
        // presence only: nothing to read from disk
    }

    @Override
    public void clear() {
        enabled.set(0);
    }

    @Override
    public long value() {
        return enabled.get();
    }
}
