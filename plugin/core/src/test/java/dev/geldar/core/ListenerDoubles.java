package dev.geldar.core;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.inventory.Recipe;

/** Hand-written Player and Server doubles (no MockBukkit release targets Paper 26.1). */
final class ListenerDoubles {
    private ListenerDoubles() {}

    /** A Player named {@code name} on a server with the given recipes; discovered keys land in {@code sink}. */
    static Player player(String name, List<NamespacedKey> recipeKeys, List<NamespacedKey> sink) {
        return player(name, recipeKeys, sink, null);
    }

    /** As above, and {@code getLastDamageCause} returns {@code lastDamage}. */
    static Player player(
            String name, List<NamespacedKey> recipeKeys, List<NamespacedKey> sink, EntityDamageEvent lastDamage) {
        List<Recipe> recipes = new ArrayList<>();
        // A recipe that is not Keyed must be skipped by the listener, so the server always holds one.
        recipes.add((Recipe) Proxy.newProxyInstance(
                ListenerDoubles.class.getClassLoader(), new Class<?>[] {Recipe.class}, (p, m, a) -> null));
        for (NamespacedKey key : recipeKeys) {
            recipes.add((Recipe) Proxy.newProxyInstance(
                    ListenerDoubles.class.getClassLoader(),
                    new Class<?>[] {Recipe.class, Keyed.class},
                    (p, m, a) -> m.getName().equals("getKey") ? key : null));
        }
        Server server = (Server) Proxy.newProxyInstance(
                ListenerDoubles.class.getClassLoader(),
                new Class<?>[] {Server.class},
                (p, m, a) -> switch (m.getName()) {
                    case "recipeIterator" -> recipes.iterator();
                    case "getOnlinePlayers" -> List.of();
                    default -> null;
                });
        return (Player) Proxy.newProxyInstance(
                ListenerDoubles.class.getClassLoader(),
                new Class<?>[] {Player.class},
                (p, m, a) -> switch (m.getName()) {
                    case "getName" -> name;
                    case "getServer" -> server;
                    case "getLastDamageCause" -> lastDamage;
                    case "discoverRecipes" -> {
                        sink.addAll((Collection<NamespacedKey>) a[0]);
                        yield a[0] instanceof Collection<?> c ? c.size() : 0;
                    }
                    default -> null;
                });
    }
}