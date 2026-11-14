package dev.geldar.core.skins;

import de.bluecolored.bluemap.api.BlueMapAPI;
import java.awt.image.BufferedImage;
import java.nio.file.Path;
import java.util.function.Function;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/**
 * Registers the agent skin provider with BlueMap. Does nothing unless BlueMap is enabled, so the plugin runs
 * without it. The skins directory comes from GELDAR_AGENT_SKINS_DIR (default /data/skins, read-only mount).
 * {@link #register} never throws: a missing BlueMap class, a missing server or any other failure leaves the
 * skins unset and logs why, so graves and Kino setup still run.
 */
public final class AgentSkinSetup {
    static final String SKINS_DIR_VARIABLE = "GELDAR_AGENT_SKINS_DIR";
    static final String DEFAULT_SKINS_DIR = "/data/skins";

    private volatile AgentSkinProvider provider;

    private AgentSkinSetup() {
    }

    /** Registers the provider now, or when BlueMap enables (BlueMap replaces its Mojang provider with this one). */
    public static AgentSkinSetup register(Plugin plugin, Function<String, String> env) {
        AgentSkinSetup setup = new AgentSkinSetup();
        Logger log = plugin.getLogger();
        try {
            if (!Bukkit.getPluginManager().isPluginEnabled("BlueMap")) {
                log.info("BlueMap is not enabled; agent skins are not set");
                return setup;
            }
            String configured = env.apply(SKINS_DIR_VARIABLE);
            Path dir = Path.of(configured == null || configured.isBlank() ? DEFAULT_SKINS_DIR : configured);
            BufferedImage fallback = AgentSkinLookup.defaultSkin();
            AgentSkinLookup lookup = new AgentSkinLookup(dir, fallback, log);
            // Built inside the try: loading the provider needs the BlueMap API classes.
            AgentSkinProvider skins = new AgentSkinProvider(lookup::lookup, fallback, log);
            BlueMapAPI.onEnable(api -> {
                setup.provider = skins;
                api.getPlugin().setSkinProvider(skins);
            });
            // BlueMap is disabling: drop our reference (BlueMap's plugin object keeps its own).
            BlueMapAPI.onDisable(api -> setup.provider = null);
        } catch (LinkageError e) {
            log.warning("BlueMap API is not on the classpath; agent skins are not set");
        } catch (RuntimeException e) {
            log.warning("agent skins are not set: " + e.getClass().getSimpleName());
        }
        return setup;
    }

}
