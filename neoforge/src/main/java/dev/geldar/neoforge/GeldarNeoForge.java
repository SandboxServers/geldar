package dev.geldar.neoforge;

import com.mojang.logging.LogUtils;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import org.slf4j.Logger;

/** Server-only entry point. Loads on the dedicated server only; registers nothing. */
@Mod(value = "geldar_neoforge", dist = Dist.DEDICATED_SERVER)
public final class GeldarNeoForge {
    private static final Logger LOGGER = LogUtils.getLogger();

    public GeldarNeoForge() {
        NeoForge.EVENT_BUS.addListener(GeldarNeoForge::onServerStarting);
    }

    private static void onServerStarting(ServerStartingEvent event) {
        LOGGER.info("{} loaded on the dedicated server", ModInfo.modId());
    }
}
