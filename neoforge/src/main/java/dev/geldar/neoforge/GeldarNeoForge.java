package dev.geldar.neoforge;

import com.mojang.logging.LogUtils;
import java.nio.file.Path;
import net.minecraft.server.MinecraftServer;
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
    private static volatile MaintenanceLifecycle maintenance;

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
            startMaintenance(config, event);
        } catch (RuntimeException e) {
            SINK.warn("geldar_neoforge export disabled: setup failed (" + e.getClass().getSimpleName() + ")");
        }
    }

    /** Maintenance notices follow the export's config and never throw; they are off unless the export is on. */
    private static void startMaintenance(ExportConfig config, ServerStartingEvent event) {
        try {
            // UNVERIFIED on 26.1: ServerStartingEvent#getServer. Confirm with a GameTest or a first server run.
            MinecraftServer server = event.getServer();
            MaintenanceLifecycle lifecycle = new MaintenanceLifecycle(
                    config, MaintenanceLifecycle.natsSubscriber(), MaintenanceBroadcast.serverThread(server),
                    MaintenanceBroadcast.systemLine(server), SINK);
            lifecycle.start();
            maintenance = lifecycle;
        } catch (RuntimeException e) {
            SINK.warn("geldar_neoforge maintenance notices disabled: setup failed (" + e.getClass().getSimpleName()
                    + ")");
        }
    }

    private static void onServerStopping(ServerStoppingEvent event) {
        MaintenanceLifecycle notices = maintenance;
        maintenance = null;
        if (notices != null) {
            notices.stop();
        }
        ExportLifecycle lifecycle = export;
        export = null;
        if (lifecycle != null) {
            lifecycle.stop();
        }
    }
}
