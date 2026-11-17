package dev.geldar.ledger.paper.bridge;

import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * A read-only view of one other plugin (Chunky, BlueMap or CoreProtect). A bridge never compiles against the other
 * plugin and never calls into it: it reads {@link PluginManager#getPlugin} presence and, for Chunky, the plugin's own
 * public files on disk. {@link #probe} is O(1) and runs on the main thread; {@link #scan} may read files and runs
 * only on an async thread. Neither may throw an error the collector does not catch.
 */
interface Bridge {
    /** The plugin name as {@code plugin.yml} declares it. */
    String plugin();

    /** The metric this bridge feeds. */
    String metric();

    String description();

    /** Main thread, O(1): records whether the plugin is present and enabled, and where its data folder is. */
    void probe(PluginManager manager);

    /** Async thread only: reads the plugin's public files. */
    void scan();

    /** Zeroes the value (the plugin is gone or the bridge failed). */
    void clear();

    /** The gauge value: a field read. */
    long value();

    /** The plugin when it is present and enabled, otherwise null. */
    static Plugin enabled(PluginManager manager, String name) {
        Plugin p = manager.getPlugin(name);
        return p != null && p.isEnabled() ? p : null;
    }
}
