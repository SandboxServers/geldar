package dev.geldar.core;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.Recipe;

/** Unlocks every registered recipe on join, so table crafts work without RCON (decision 0032). */
public final class RecipeGrantListener implements Listener {

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        List<NamespacedKey> keys = new ArrayList<>();
        Iterator<Recipe> it = player.getServer().recipeIterator();
        while (it.hasNext()) {
            if (it.next() instanceof Keyed keyed) {
                keys.add(keyed.getKey());
            }
        }
        player.discoverRecipes(keys);
    }
}