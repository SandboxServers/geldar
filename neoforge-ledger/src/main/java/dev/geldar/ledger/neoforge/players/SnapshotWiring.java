package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.neoforge.CollectorCtx;
import dev.geldar.ledger.neoforge.LedgerLog;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/** The only Minecraft-facing part of the snapshot collector; opt-in (the collector checks the flag at start). */
public final class SnapshotWiring {
    private static final Logger LOG = LedgerLog.server();

    private final Ledger ledger;
    private final HostInfo host;
    private final HostScheduler scheduler;
    private volatile SnapshotCollector collector;

    private SnapshotWiring(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        this.ledger = ledger;
        this.host = host;
        this.scheduler = scheduler;
    }

    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null || !ledger.config().collectorEnabled(SnapshotCollector.ID)
                || !Boolean.TRUE.equals(ledger.config().collectorEnabled().get(SnapshotCollector.ID))) {
            return;
        }
        SnapshotWiring w = new SnapshotWiring(ledger, host, scheduler);
        NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.start(e.getServer()));
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.stop());
    }

    private void start(MinecraftServer server) {
        try {
            SnapshotCollector c = new SnapshotCollector(() -> {
                List<SnapshotCollector.Ref> refs = new ArrayList<>();
                for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                    refs.add(ref(p));
                }
                return refs;
            });
            c.start(new CollectorCtx(ledger, host, scheduler));
            collector = c;
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger snapshot collector failed, off: " + t.getClass().getName());
        }
    }

    private static SnapshotCollector.Ref ref(ServerPlayer p) {
        return new SnapshotCollector.Ref() {
            @Override
            public String name() {
                return p.getGameProfile().name();
            }

            @Override
            public SnapshotCollector.Reading read() {
                return new SnapshotCollector.Reading(
                        p.level().dimension().identifier().toString(),
                        (int) Math.floor(p.getX()),
                        (int) Math.floor(p.getY()),
                        (int) Math.floor(p.getZ()),
                        p.getHealth(),
                        p.getFoodData().getFoodLevel(),
                        p.experienceLevel,
                        p.gameMode().getName());
            }
        };
    }

    private void stop() {
        SnapshotCollector c = collector;
        collector = null;
        if (c != null) {
            c.stop();
        }
    }
}