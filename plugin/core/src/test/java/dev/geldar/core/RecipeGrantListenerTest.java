package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerJoinEvent;
import org.junit.jupiter.api.Test;

class RecipeGrantListenerTest {
    @Test
    void joinDiscoversEveryRegisteredRecipe() {
        List<NamespacedKey> keys = List.of(
                new NamespacedKey("minecraft", "crafting_table"),
                new NamespacedKey("minecraft", "stone_pickaxe"),
                new NamespacedKey("minecraft", "furnace"));
        List<NamespacedKey> granted = new ArrayList<>();
        Player player = ListenerDoubles.player("ag_wren_02", keys, granted);

        new RecipeGrantListener(Logger.getLogger("test")).onJoin(new PlayerJoinEvent(player, Component.empty()));

        assertEquals(keys, granted);
    }

    @Test
    void aFailingGrantIsLoggedAndNeverThrownIntoTheServerThread() {
        List<NamespacedKey> keys = List.of(new NamespacedKey("minecraft", "furnace"));
        List<NamespacedKey> failing = new ArrayList<>() {
            @Override
            public boolean addAll(java.util.Collection<? extends NamespacedKey> c) {
                throw new IllegalStateException("server refused the discovery");
            }
        };
        Player player = ListenerDoubles.player("ag_wren_02", keys, failing);

        assertDoesNotThrow(() -> new RecipeGrantListener(Logger.getLogger("test"))
                .onJoin(new PlayerJoinEvent(player, Component.empty())));
    }
}
