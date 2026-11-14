package dev.geldar.core.skins;

import de.bluecolored.bluemap.api.BlueMapAPI;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.function.Function;
import java.util.logging.Logger;
import javax.imageio.ImageIO;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/**
 * Registers the agent skin provider with BlueMap. Does nothing unless BlueMap is enabled, so the plugin runs
 * without it. The skins directory comes from GELDAR_SKINS_DIR (default /data/skins, read-only mount).
 */
public final class AgentSkinSetup {
    static final String SKINS_DIR_VARIABLE = "GELDAR_SKINS_DIR";
    static final String DEFAULT_SKINS_DIR = "/data/skins";
    static final String DEFAULT_SKIN_RESOURCE = "/agent-default-skin.png";

    private volatile AgentSkinProvider provider;

    private AgentSkinSetup() {
    }

    /** Registers the provider now, or when BlueMap enables (BlueMap replaces its Mojang provider with this one). */
    public static AgentSkinSetup register(Plugin plugin, Function<String, String> env) {
        AgentSkinSetup setup = new AgentSkinSetup();
        Logger log = plugin.getLogger();
        if (!Bukkit.getPluginManager().isPluginEnabled("BlueMap")) {
            log.info("BlueMap is not enabled; agent skins are not set");
            return setup;
        }
        String configured = env.apply(SKINS_DIR_VARIABLE);
        Path dir = Path.of(configured == null || configured.isBlank() ? DEFAULT_SKINS_DIR : configured);
        BufferedImage fallback = loadDefaultSkin(log);
        AgentSkinLookup lookup = new AgentSkinLookup(dir, fallback, log);
        AgentSkinProvider skins = new AgentSkinProvider(lookup::lookup, fallback, log);
        try {
            BlueMapAPI.onEnable(api -> {
                setup.provider = skins;
                api.getPlugin().setSkinProvider(skins);
            });
            // BlueMap is disabling: drop our reference (BlueMap's plugin object keeps its own).
            BlueMapAPI.onDisable(api -> setup.provider = null);
        } catch (NoClassDefFoundError e) {
            log.warning("BlueMap API is not on the classpath; agent skins are not set");
        }
        return setup;
    }

    /** The default skin from the plugin's resources, or a solid grey square when the resource cannot be loaded. */
    static BufferedImage loadDefaultSkin(Logger log) {
        try (InputStream in = AgentSkinSetup.class.getResourceAsStream(DEFAULT_SKIN_RESOURCE)) {
            if (in != null) {
                BufferedImage image = ImageIO.read(in);
                if (image != null) {
                    return image;
                }
            }
            log.warning("default agent skin resource is missing; using a solid colour");
        } catch (IOException e) {
            log.warning("default agent skin resource is unreadable: " + e.getClass().getSimpleName());
        }
        BufferedImage solid = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < 64; x++) {
            for (int y = 0; y < 64; y++) {
                solid.setRGB(x, y, 0xff6b7785);
            }
        }
        return solid;
    }
}
