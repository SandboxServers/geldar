package dev.geldar.core;

import com.destroystokyo.paper.profile.PlayerProfile;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
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
 * Ghost enforcement (spec 8.4, decisions 0092 and 0137). Paper fails closed: a joiner whose forwarded
 * profile lacks {@link #LIVE_PROPERTY} (set by the bot-ingress Velocity only for a live life, inside the
 * signed forwarding data) is a ghost and is held in spectator at the first join event, before any other
 * handler runs. Velocity's message on {@link #CHANNEL} is a second path and can only add a ghost. A ghost
 * is held in spectator on join, respawn and world change, any game-mode change to something else is
 * cancelled, and its chat is cancelled, so no agent can ever hear a watcher (decisions 0059, 0068). If
 * spectator cannot be applied the player is kicked.
 */
public final class GhostListener implements Listener, PluginMessageListener {
    /** The plugin-message channel Velocity sends on; the payload is not read. */
    public static final String CHANNEL = "geldar:ghost";
    /** The forwarded profile property that marks a live login. Must equal IdentityPlugin.LIVE_PROPERTY. */
    public static final String LIVE_PROPERTY = "geldar_live";
    /** Shown on a kick; says nothing about why (Principle 1). */
    static final String KICK_MESSAGE = "This connection is not admitted.";

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

    /** First handler to run on a join: a joiner without the live property is a ghost from this moment. */
    @EventHandler(priority = EventPriority.LOWEST)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (!hasLiveProperty(player)) {
            ghosts.add(player.getUniqueId());
        }
        if (isGhost(player)) {
            hold(player);
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

    /** Absent, unreadable or any other value counts as "not live". */
    private boolean hasLiveProperty(Player player) {
        try {
            PlayerProfile profile = player.getPlayerProfile();
            return profile != null
                    && profile.getProperties().stream().anyMatch(p -> LIVE_PROPERTY.equals(p.getName()));
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "could not read the forwarded profile; treating the player as a ghost", e);
            return false;
        }
    }

    private void hold(Player player) {
        try {
            if (player.getGameMode() != GameMode.SPECTATOR) {
                player.setGameMode(GameMode.SPECTATOR);
            }
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "could not hold a ghost in spectator; kicking", e);
            try {
                player.kick(Component.text(KICK_MESSAGE));
            } catch (RuntimeException kickFailure) {
                log.log(Level.SEVERE, "could not kick a ghost that is not in spectator", kickFailure);
            }
        }
    }
}
