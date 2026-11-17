package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.AdvancementEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * The only Minecraft-facing part of PT-N9: registers the advancement and login events and starts the
 * {@link ProgressCollector} once the server exists. Observe only. Fail-safe: any failure leaves the collector off.
 */
public final class ProgressWiring {
    private static final Logger LOG = Logger.getLogger("ledger");

    private final Ledger ledger;
    private final HostInfo host;
    private final HostScheduler scheduler;
    private volatile ProgressCollector collector;

    private ProgressWiring(Ledger ledger, HostInfo host, HostScheduler scheduler) {
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
            ProgressWiring w = new ProgressWiring(ledger, host, scheduler);
            NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.start(e.getServer()));
            NeoForge.EVENT_BUS.addListener(
                    PlayerEvent.PlayerLoggedInEvent.class, e -> guarded(() -> w.join(e.getEntity())));
            NeoForge.EVENT_BUS.addListener(
                    PlayerEvent.PlayerLoggedOutEvent.class, e -> guarded(() -> w.quit(e.getEntity())));
            NeoForge.EVENT_BUS.addListener(
                    AdvancementEvent.AdvancementEarnEvent.class,
                    e -> guarded(() -> w.advance(e.getEntity(), e.getAdvancement().id().toString(), true)));
            NeoForge.EVENT_BUS.addListener(
                    AdvancementEvent.AdvancementProgressEvent.class,
                    e -> guarded(() -> {
                        if (exported(e.getProgressType().name())) {
                            w.advance(e.getEntity(), e.getAdvancement().id().toString(), false);
                        }
                    }));
            NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.stop());
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger progress wiring failed: " + t.getClass().getName());
        }
    }

    /** Only a criterion grant is exported; a revoke never is. */
    static boolean exported(String progressType) {
        return "GRANT".equals(progressType);
    }

    /** Runs a listener body, argument extraction included; nothing but a VM error escapes into the event bus. */
    static void guarded(Runnable body) {
        try {
            body.run();
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
        }
    }

    private void start(MinecraftServer server) {
        try {
            ProgressCollector c = new ProgressCollector(() -> server.getWorldPath(LevelResource.PLAYER_STATS_DIR));
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
            // players already online (none at ServerStarted on a dedicated server) would be added by their login event
            collector = c;
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger progress collector failed, off: " + t.getClass().getName());
        }
    }

    private void join(Player p) {
        ProgressCollector c = collector;
        if (c != null) {
            try {
                c.join(p.getUUID(), p.getGameProfile().name());
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }

    private void quit(Player p) {
        ProgressCollector c = collector;
        if (c != null) {
            try {
                c.quit(p.getUUID());
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }

    private void advance(Player p, String key, boolean earned) {
        ProgressCollector c = collector;
        if (c != null) {
            try {
                c.advancement(p.getGameProfile().name(), key, earned);
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }

    private void stop() {
        ProgressCollector c = collector;
        collector = null;
        if (c != null) {
            c.stop();
        }
    }
}
