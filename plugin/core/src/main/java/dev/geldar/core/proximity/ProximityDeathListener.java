package dev.geldar.core.proximity;

import java.util.Collection;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;

/**
 * Death is announced only to the players within {@link ProximityRule#HEARING_RADIUS_BLOCKS} of the deceased (spec
 * 5.9). The server-wide broadcast is cleared, the line goes to those players, and to the console for the log. The
 * death event itself is not cancelled, so the death export and the gravestone listener are unchanged.
 */
public final class ProximityDeathListener implements Listener {
    private final Supplier<Collection<? extends Player>> online;
    private final Consumer<Component> console;
    private final Logger log;

    /**
     * @param online the players on the server now (production: {@code Bukkit.getOnlinePlayers()})
     * @param console receives the line for the server log (production: the console sender)
     */
    public ProximityDeathListener(
            Supplier<Collection<? extends Player>> online, Consumer<Component> console, Logger log) {
        this.online = online;
        this.console = console;
        this.log = log;
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onDeath(PlayerDeathEvent event) {
        Component message = event.deathMessage();
        if (message == null) {
            return;
        }
        event.deathMessage(null);
        Location at = event.getEntity().getLocation();
        for (Player player : online.get()) {
            if (Hearing.between(at, player.getLocation())) {
                send(player, message);
            }
        }
        try {
            console.accept(message);
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "death message not logged to the console", e);
        }
    }

    private void send(Player player, Component message) {
        try {
            player.sendMessage(message);
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "death message not delivered to a nearby player", e);
        }
    }
}
