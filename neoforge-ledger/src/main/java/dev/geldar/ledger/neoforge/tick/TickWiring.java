package dev.geldar.ledger.neoforge.tick;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;
import java.util.logging.Logger;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * The only Minecraft-facing part of PT-N4a: registers the tick events and starts the {@link TickCollector} once the
 * server (and so its dimensions) exists. Fail-safe: any failure leaves the collector off and the server running.
 */
public final class TickWiring {
    private static final Logger LOG = Logger.getLogger("ledger");

    private final Ledger ledger;
    private final HostInfo host;
    private final HostScheduler scheduler;
    private volatile TickCollector collector;

    private TickWiring(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        this.ledger = ledger;
        this.host = host;
        this.scheduler = scheduler;
    }

    /** Registers the listeners on the NeoForge bus; call from the mod constructor. Does nothing for a null ledger. */
    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null) {
            return;
        }
        try {
            TickWiring w = new TickWiring(ledger, host, scheduler);
            NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.start(e.getServer()));
            NeoForge.EVENT_BUS.addListener(ServerTickEvent.Pre.class, e -> w.pre());
            NeoForge.EVENT_BUS.addListener(ServerTickEvent.Post.class, e -> w.post());
            NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.stop());
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger tick wiring failed: " + t.getClass().getName());
        }
    }

    private void start(MinecraftServer server) {
        try {
            Map<String, Supplier<long[]>> dims = new LinkedHashMap<>();
            for (ResourceKey<Level> key : server.levelKeys()) {
                dims.put(key.identifier().toString(), () -> server.getTickTime(key));
            }
            TickCollector c = new TickCollector(dims, () -> server.getPlayerList().getPlayerCount() == 0);
            c.start(new CollectorContext() {
                @Override
                public Ledger ledger() {
                    return ledger;
                }

                @Override
                public HostScheduler scheduler() {
                    return scheduler;
                }

                @Override
                public HostInfo host() {
                    return host;
                }
            });
            collector = c;
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger tick collector failed, off: " + t.getClass().getName());
        }
    }

    private void pre() {
        TickCollector c = collector;
        TickListener l = c == null ? null : c.listener();
        if (l != null) {
            l.pre();
        }
    }

    private void post() {
        TickCollector c = collector;
        TickListener l = c == null ? null : c.listener();
        if (l != null) {
            l.post(host.serverTick());
        }
    }

    private void stop() {
        TickCollector c = collector;
        collector = null;
        if (c != null) {
            c.stop();
        }
    }
}
