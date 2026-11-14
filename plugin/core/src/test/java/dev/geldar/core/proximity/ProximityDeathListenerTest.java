package dev.geldar.core.proximity;

import static dev.geldar.core.proximity.ProximityPlayers.at;
import static dev.geldar.core.proximity.ProximityPlayers.player;
import static dev.geldar.core.proximity.ProximityPlayers.world;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.junit.jupiter.api.Test;

class ProximityDeathListenerTest {
    private static final Component LINE = Component.text("Kestrel was slain");
    private static final DamageSource SOURCE = (DamageSource) Proxy.newProxyInstance(
            ProximityDeathListenerTest.class.getClassLoader(),
            new Class<?>[] {DamageSource.class},
            (p, m, a) -> null);

    @Test
    void theDeathLineGoesOnlyToThePlayersWithin32BlocksAndTheConsole() {
        World overworld = world("world");
        World nether = world("world_nether");
        List<Component> deadSink = new ArrayList<>();
        List<Component> nearSink = new ArrayList<>();
        List<Component> edgeSink = new ArrayList<>();
        List<Component> farSink = new ArrayList<>();
        List<Component> otherSink = new ArrayList<>();
        Player dead = player(at(overworld, 100, 64, 100), deadSink);
        Player near = player(at(overworld, 131.99, 64, 100), nearSink);
        Player edge = player(at(overworld, 100, 64, 132.0), edgeSink);
        Player far = player(at(overworld, 132.01, 64, 100), farSink);
        Player otherWorld = player(at(nether, 100, 64, 100), otherSink);
        List<Component> console = new ArrayList<>();
        List<Player> online = List.of(dead, near, edge, far, otherWorld);

        PlayerDeathEvent event = death(dead);
        new ProximityDeathListener(() -> online, console::add, Logger.getLogger("test")).onDeath(event);

        assertNull(event.deathMessage());
        assertEquals(List.of(LINE), deadSink);
        assertEquals(List.of(LINE), nearSink);
        assertEquals(List.of(LINE), edgeSink);
        assertTrue(farSink.isEmpty());
        assertTrue(otherSink.isEmpty());
        assertEquals(List.of(LINE), console);
    }

    @Test
    void aFailedDeliveryDoesNotStopTheOthersOrTheConsole() {
        World overworld = world("world");
        List<Component> nearSink = new ArrayList<>();
        Player dead = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player refusing = player(at(overworld, 1, 64, 0), null);
        Player near = player(at(overworld, 2, 64, 0), nearSink);
        List<Component> console = new ArrayList<>();
        List<Player> online = List.of(dead, refusing, near);

        new ProximityDeathListener(() -> online, console::add, Logger.getLogger("test")).onDeath(death(dead));

        assertEquals(List.of(LINE), nearSink);
        assertEquals(List.of(LINE), console);
    }

    @Test
    void aDeathWithoutAMessageSendsNothing() {
        World overworld = world("world");
        List<Component> nearSink = new ArrayList<>();
        Player dead = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player near = player(at(overworld, 1, 64, 0), nearSink);
        List<Component> console = new ArrayList<>();
        List<Player> online = List.of(dead, near);
        PlayerDeathEvent event = new PlayerDeathEvent(dead, SOURCE, new ArrayList<>(), 0, null, true);

        new ProximityDeathListener(() -> online, console::add, Logger.getLogger("test")).onDeath(event);

        assertTrue(nearSink.isEmpty());
        assertTrue(console.isEmpty());
    }

    private static PlayerDeathEvent death(Player dead) {
        return new PlayerDeathEvent(dead, SOURCE, new ArrayList<>(), 0, LINE, true);
    }
}
