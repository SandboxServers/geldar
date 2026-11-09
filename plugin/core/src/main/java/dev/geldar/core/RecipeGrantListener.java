package dev.geldar.core;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.Recipe;

/**
 * Unlocks every registered recipe on join (decision 0032). Off by default since decision 0048: recipes
 * unlock through play, and {@code recipes.grant_on_join} registers this listener again.
 */
public final class RecipeGrantListener implements Listener {
    private final Logger log;

    public RecipeGrantListener(Logger log) {
        this.log = log;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        // Never throws into the server thread: a failed grant leaves the player with the vanilla recipe book.
        try {
            Player player = event.getPlayer();
            List<NamespacedKey> keys = new ArrayList<>();
            Iterator<Recipe> it = player.getServer().recipeIterator();
            while (it.hasNext()) {
                if (it.next() instanceof Keyed keyed) {
                    keys.add(keyed.getKey());
                }
            }
            player.discoverRecipes(keys);
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "recipe grant on join failed", e);
        }
    }
}