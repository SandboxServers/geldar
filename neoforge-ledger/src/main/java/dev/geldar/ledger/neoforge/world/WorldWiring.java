package dev.geldar.ledger.neoforge.world;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.neoforge.CollectorCtx;
import dev.geldar.ledger.neoforge.LedgerLog;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.EntityLeaveLevelEvent;
import net.neoforged.neoforge.event.level.ChunkEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * The only Minecraft-facing part of the world collector: chunk and entity events feed {@link WorldCounts} from the
 * mod constructor on (spawn chunks load before the server has started), and the collector starts at ServerStarted.
 * Observe only; a listener never throws into the bus.
 */
public final class WorldWiring {
    private static final Logger LOG = LedgerLog.server();

    private final Ledger ledger;
    private final HostInfo host;
    private final HostScheduler scheduler;
    private final WorldCounts counts = new WorldCounts();
    private volatile WorldCollector collector;

    private WorldWiring(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        this.ledger = ledger;
        this.host = host;
        this.scheduler = scheduler;
    }

    /** Registers the listeners on the NeoForge bus; does nothing for a null ledger or a disabled collector. */
    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null || !ledger.config().collectorEnabled(WorldCollector.ID)) {
            return;
        }
        WorldWiring w = new WorldWiring(ledger, host, scheduler);
        NeoForge.EVENT_BUS.addListener(ChunkEvent.Load.class, e -> w.chunk(e.getLevel(), 1));
        NeoForge.EVENT_BUS.addListener(ChunkEvent.Unload.class, e -> w.chunk(e.getLevel(), -1));
        NeoForge.EVENT_BUS.addListener(EntityJoinLevelEvent.class, e -> w.entity(e.getLevel(), e.getEntity(), 1));
        NeoForge.EVENT_BUS.addListener(EntityLeaveLevelEvent.class, e -> w.entity(e.getLevel(), e.getEntity(), -1));
        NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.start(e.getServer()));
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.stop());
    }

    private void chunk(Object level, int delta) {
        try {
            if (level instanceof ServerLevel sl) {
                counts.chunk(sl.dimension().identifier().toString(), delta);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    private void entity(Object level, Object entity, int delta) {
        try {
            if (level instanceof ServerLevel sl) {
                counts.entity(sl.dimension().identifier().toString(), entity instanceof ServerPlayer, delta);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    private void start(MinecraftServer server) {
        try {
            WorldCollector c = new WorldCollector(counts, () -> {
                List<String> names = new ArrayList<>();
                for (ResourceKey<Level> key : server.levelKeys()) {
                    names.add(key.identifier().toString());
                }
                return names;
            });
            c.start(new CollectorCtx(ledger, host, scheduler));
            collector = c;
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger world collector failed, off: " + t.getClass().getName());
        }
    }

    private void stop() {
        WorldCollector c = collector;
        collector = null;
        if (c != null) {
            c.stop();
        }
    }
}