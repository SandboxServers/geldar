package dev.geldar.neoforge;

import com.mojang.logging.LogUtils;
import java.nio.file.Path;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;

/**
 * Server-only entry point. Loads on the dedicated server only; registers nothing. The export starts with the
 * server and is off unless configured (see README.md). Nothing here may stop the server.
 */
@Mod(value = "geldar_neoforge", dist = Dist.DEDICATED_SERVER)
public final class GeldarNeoForge {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final OperatorSink SINK = new OperatorSink() {
        @Override
        public void info(String message) {
            LOGGER.info(message);
        }

        @Override
        public void warn(String message) {
            LOGGER.warn(message);
        }
    };
    private static volatile ExportLifecycle export;

    public GeldarNeoForge() {
        NeoForge.EVENT_BUS.addListener(GeldarNeoForge::onServerStarting);
        NeoForge.EVENT_BUS.addListener(GeldarNeoForge::onServerStopping);
    }

    private static void onServerStarting(ServerStartingEvent event) {
        LOGGER.info("{} loaded on the dedicated server", ModInfo.modId());
        try {
            ExportConfig config = ExportConfig.load(
                    Path.of("config", ExportConfig.FILE_NAME), System::getenv, ExportConfig::isReadableFile, SINK);
            ExportLifecycle lifecycle = new ExportLifecycle(config, ExportLifecycle.natsPublisher(), SINK);
            lifecycle.start();
            export = lifecycle;
        } catch (RuntimeException e) {
            SINK.warn("geldar_neoforge export disabled: setup failed (" + e.getClass().getSimpleName() + ")");
        }
    }

    private static void onServerStopping(ServerStoppingEvent event) {
        ExportLifecycle lifecycle = export;
        export = null;
        if (lifecycle != null) {
            lifecycle.stop();
        }
    }
}
