package dev.geldar.core.proximity;

import java.lang.reflect.Proxy;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Proxy stand-ins for the Bukkit types the proximity listeners touch (no Bukkit mock exists in the repo). */
final class ProximityPlayers {
    private static final AtomicInteger NEXT = new AtomicInteger();

    private ProximityPlayers() {
    }

    static World world(String name) {
        return (World) Proxy.newProxyInstance(
                ProximityPlayers.class.getClassLoader(),
                new Class<?>[] {World.class},
                (p, m, a) -> switch (m.getName()) {
                    case "getName" -> name;
                    case "hashCode" -> System.identityHashCode(p);
                    case "equals" -> p == a[0];
                    default -> null;
                });
    }

    static Location at(World world, double x, double y, double z) {
        return new Location(world, x, y, z);
    }

    /** A player with a unique name that is not a life id. Every line sent to it is added to {@code received}. */
    static Player player(Location at, List<Component> received) {
        return player("human" + NEXT.incrementAndGet(), at, received);
    }

    /**
     * A player with this name at {@code at}. The name is the life id for an agent. Every line sent to it is added to
     * {@code received}; a null sink makes sends throw.
     */
    static Player player(String name, Location at, List<Component> received) {
        return (Player) Proxy.newProxyInstance(
                ProximityPlayers.class.getClassLoader(),
                new Class<?>[] {Player.class},
                (p, m, a) -> switch (m.getName()) {
                    case "getName" -> name;
                    case "getLocation" -> at.clone();
                    case "sendMessage" -> {
                        if (received == null) {
                            throw new IllegalStateException("refused");
                        }
                        if (a.length == 1 && a[0] instanceof Component line) {
                            received.add(line);
                        }
                        yield null;
                    }
                    case "hashCode" -> System.identityHashCode(p);
                    case "equals" -> p == a[0];
                    default -> null;
                });
    }

    /** A non-player audience: the server console. */
    static Audience console() {
        return (Audience) Proxy.newProxyInstance(
                ProximityPlayers.class.getClassLoader(),
                new Class<?>[] {Audience.class},
                (p, m, a) -> switch (m.getName()) {
                    case "hashCode" -> System.identityHashCode(p);
                    case "equals" -> p == a[0];
                    default -> null;
                });
    }
}
