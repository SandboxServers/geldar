package dev.geldar.core.proximity;

import static dev.geldar.core.proximity.ProximityPlayers.at;
import static dev.geldar.core.proximity.ProximityPlayers.console;
import static dev.geldar.core.proximity.ProximityPlayers.player;
import static dev.geldar.core.proximity.ProximityPlayers.world;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

class ProximityChatListenerTest {
    private static final Component LINE = Component.text("hello");

    @Test
    void farPlayersAreRemovedAndNearOnesAndTheConsoleKept() {
        World overworld = world("world");
        World nether = world("world_nether");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player near = player(at(overworld, 31.99, 64, 0), new ArrayList<>());
        Player edge = player(at(overworld, 0, 64, 32.0), new ArrayList<>());
        Player far = player(at(overworld, 32.01, 64, 0), new ArrayList<>());
        Player otherWorld = player(at(nether, 0, 64, 0), new ArrayList<>());
        Audience console = console();
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, near, edge, far, otherWorld, console)));

        new ProximityChatListener().onChat(event);

        assertEquals(Set.of(speaker, near, edge, console), new HashSet<>(event.viewers()));
        assertFalse(event.viewers().contains(far));
        assertFalse(event.viewers().contains(otherWorld));
    }

    @Test
    void theSpeakerKeepsTheirOwnLineEvenAloneWithAFarPlayer() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player far = player(at(overworld, 500, 64, 500), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, far)));

        new ProximityChatListener().onChat(event);

        assertEquals(Set.of(speaker), new HashSet<>(event.viewers()));
    }

    @Test
    void theMessageIsNotCancelledOrRewritten() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player far = player(at(overworld, 500, 64, 500), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, far)));

        new ProximityChatListener().onChat(event);

        assertFalse(event.isCancelled());
        assertEquals(LINE, event.originalMessage());
    }

    @Test
    void aSpeakerInTheMiddleOfAnotherWorldStillHearsOnlyTheirWorld() {
        World overworld = world("world");
        World nether = world("world_nether");
        Player speaker = player(at(nether, 10, 70, 10), new ArrayList<>());
        Player sameWorldNear = player(at(nether, 20, 70, 10), new ArrayList<>());
        Player overworldNear = player(at(overworld, 10, 70, 10), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, sameWorldNear, overworldNear)));

        new ProximityChatListener().onChat(event);

        assertTrue(event.viewers().contains(sameWorldNear));
        assertFalse(event.viewers().contains(overworldNear));
    }

    private static AsyncChatEvent chat(Player speaker, Set<Audience> viewers) {
        return new AsyncChatEvent(true, speaker, viewers, null, LINE, LINE, null);
    }
}
