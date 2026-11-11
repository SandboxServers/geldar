package dev.geldar.core;

import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.plugin.messaging.PluginMessageListener;

/**
 * Ghost enforcement (spec 8.4, decision 0092). Velocity tells Paper which connections are ghosts (a
 * registered name whose life is not live) with one message on {@link #CHANNEL} after the backend
 * connection is up. A ghost is held in spectator: forced on the signal, on respawn and on a world
 * change, and any game-mode change to something else is cancelled. A ghost's chat is cancelled, so no
 * agent can ever hear a watcher (decisions 0059, 0068). The signal can only add a ghost: a client that
 * forges it restricts itself and nobody else.
 */
public final class GhostListener implements Listener, PluginMessageListener {
    /** The plugin-message channel Velocity sends on; the payload is not read. */
    public static final String CHANNEL = "geldar:ghost";

    private final Set<UUID> ghosts = ConcurrentHashMap.newKeySet();
    private final Logger log;

    public GhostListener(Logger log) {
        this.log = log;
    }

    public boolean isGhost(Player player) {
        return ghosts.contains(player.getUniqueId());
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (!CHANNEL.equals(channel)) {
            return;
        }
        ghosts.add(player.getUniqueId());
        hold(player);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        if (isGhost(event.getPlayer())) {
            hold(event.getPlayer());
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        ghosts.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        if (isGhost(event.getPlayer())) {
            hold(event.getPlayer());
        }
    }

    @EventHandler
    public void onWorldChange(PlayerChangedWorldEvent event) {
        if (isGhost(event.getPlayer())) {
            hold(event.getPlayer());
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onGameModeChange(PlayerGameModeChangeEvent event) {
        if (isGhost(event.getPlayer()) && event.getNewGameMode() != GameMode.SPECTATOR) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncChatEvent event) {
        if (isGhost(event.getPlayer())) {
            event.setCancelled(true);
        }
    }

    private void hold(Player player) {
        try {
            if (player.getGameMode() != GameMode.SPECTATOR) {
                player.setGameMode(GameMode.SPECTATOR);
            }
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "could not hold a ghost in spectator", e);
        }
    }
}
