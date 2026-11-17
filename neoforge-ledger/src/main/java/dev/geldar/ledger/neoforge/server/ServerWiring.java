package dev.geldar.ledger.neoforge.server;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.neoforge.CollectorCtx;
import dev.geldar.ledger.neoforge.LedgerLog;
import java.lang.management.ManagementFactory;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/** The only Minecraft-facing part of the server collector; starts it at ServerStarted. Fail-safe. */
public final class ServerWiring {
    private static final Logger LOG = LedgerLog.server();

    private final Ledger ledger;
    private final HostInfo host;
    private final HostScheduler scheduler;
    private volatile ServerCollector collector;

    private ServerWiring(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        this.ledger = ledger;
        this.host = host;
        this.scheduler = scheduler;
    }

    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null || !ledger.config().collectorEnabled(ServerCollector.ID)) {
            return;
        }
        ServerWiring w = new ServerWiring(ledger, host, scheduler);
        NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.start(e.getServer()));
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.stop());
    }

    private void start(MinecraftServer server) {
        try {
            ServerCollector c = new ServerCollector(
                    new ServerCollector.Counts() {
                        @Override
                        public long players() {
                            return server.getPlayerList().getPlayerCount();
                        }

                        @Override
                        public long operators() {
                            return server.getPlayerList().getOps().getEntries().size();
                        }

                        @Override
                        public long mods() {
                            return ModList.get().size();
                        }
                    },
                    () -> raw(server));
            c.start(new CollectorCtx(ledger, host, scheduler));
            collector = c;
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger server collector failed, off: " + t.getClass().getName());
        }
    }

    /** The allow-listed values only: server getters and the -Xmx flag. Reads no file. */
    static Map<String, String> raw(MinecraftServer server) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("server_version", String.valueOf(server.getServerVersion()));
        m.put("view_distance", String.valueOf(server.getPlayerList().getViewDistance()));
        m.put("simulation_distance", String.valueOf(server.getPlayerList().getSimulationDistance()));
        m.put("max_players", String.valueOf(server.getMaxPlayers()));
        m.put("online_mode", String.valueOf(server.usesAuthentication()));
        m.put("jvm_xmx", xmx());
        return m;
    }

    private static String xmx() {
        return JvmHeap.describe(ManagementFactory.getRuntimeMXBean().getInputArguments());
    }

    private void stop() {
        ServerCollector c = collector;
        collector = null;
        if (c != null) {
            c.stop();
        }
    }
}