package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.neoforge.CollectorCtx;
import dev.geldar.ledger.neoforge.LedgerLog;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
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
        collector.join(keyOf(p), p.getGameProfile().name(), s == null ? 0 : s.getPlayerCount());
    }

    private void quit(Player p) {
        collector.quit(keyOf(p), p.getGameProfile().name());
    }

    /**
     * The session key: the player's packet listener. Vanilla builds a new {@code ServerPlayer} after every death or End
     * exit but hands the same listener to it, so the key is stable across respawn and unique per connection (a
     * reconnect gets a new listener, so a late logout of the old one never closes the new session). It is never a dead
     * player. Null for anything that is not a connected server player.
     */
    static Object keyOf(Object player) {
        return player instanceof ServerPlayer sp ? sp.connection : null;
    }

    /** The session of a player for another collector; null when none is open. */
    public static String sessionOf(Object player) {
        Object key = keyOf(player);
        return key == null ? null : SessionIds.shared().get(key);
    }
}
