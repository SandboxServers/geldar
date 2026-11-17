package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.neoforge.CollectorCtx;
import dev.geldar.ledger.neoforge.LedgerLog;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.player.Player;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * The only Minecraft-facing part of PT-N6: the login and logout events (VERIFIED in the API spike) feed the
 * {@link ConnectionCollector}, keyed by the player object. Observe only; a failure leaves the collector off. Gaps: no
 * event is known for prelogin or a kick reason, so none is emitted.
 */
public final class ConnectionWiring {
    private static final Logger LOG = LedgerLog.server();

    private final ConnectionCollector collector = new ConnectionCollector();
    private volatile MinecraftServer server;

    private ConnectionWiring() {}

    /** Registers the listeners on the NeoForge bus; call from the mod constructor. Does nothing for a null ledger. */
    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null) {
            return;
        }
        ConnectionWiring w = new ConnectionWiring();
        w.collector.start(new CollectorCtx(ledger, host, scheduler));
        NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> w.server = e.getServer());
        NeoForge.EVENT_BUS.addListener(
                PlayerEvent.PlayerLoggedInEvent.class, e -> guarded(() -> w.join(e.getEntity())));
        NeoForge.EVENT_BUS.addListener(
                PlayerEvent.PlayerLoggedOutEvent.class, e -> guarded(() -> w.quit(e.getEntity())));
        NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> w.collector.stop());
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

    private void join(Player p) {
        MinecraftServer s = server;
        collector.join(p, p.getGameProfile().name(), s == null ? 0 : s.getPlayerCount());
    }

    private void quit(Player p) {
        collector.quit(p, p.getGameProfile().name());
    }

    /** The session of a connection for another collector; null when none is open. */
    public static String sessionOf(Object connection) {
        return SessionIds.shared().get(connection);
    }
}
