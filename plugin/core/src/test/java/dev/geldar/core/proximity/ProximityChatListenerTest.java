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
import java.util.List;
import java.util.Set;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

class ProximityChatListenerTest {
    private static final Component LINE = Component.text("hello");

    /** A listener on the server thread (the hop runs the work at once) with no blocks but the given grid. */
    private static ProximityChatListener listener(ProbeWorld grid, List<String> notices) {
        HearingNoticeSink sink = (lifeId, direction, band) -> notices.add(lifeId + " " + direction + " " + band);
        return new ProximityChatListener(
                work -> work.get(),
                () -> 1L,
                w -> grid,
                new ChatHearing(MuffleSettings.defaults(), line -> { }),
                sink);
    }

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

        listener(new ProbeWorld(), new ArrayList<>()).onChat(event);

        assertEquals(Set.of(speaker, near, edge, console), new HashSet<>(event.viewers()));
    }

    @Test
    void theSpeakerKeepsTheirOwnLineEvenAloneWithAFarPlayer() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player far = player(at(overworld, 500, 64, 500), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, far)));

        listener(new ProbeWorld(), new ArrayList<>()).onChat(event);

        assertEquals(Set.of(speaker), new HashSet<>(event.viewers()));
    }

    @Test
    void theMessageIsNotCancelledOrRewritten() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player far = player(at(overworld, 500, 64, 500), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, far)));

        listener(new ProbeWorld(), new ArrayList<>()).onChat(event);

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

        listener(new ProbeWorld(), new ArrayList<>()).onChat(event);

        assertTrue(event.viewers().contains(sameWorldNear));
        assertFalse(event.viewers().contains(overworldNear));
    }

    @Test
    void aMuffledAgentLosesTheWordsAndGetsOneNoticeNamedByItsLifeId() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0.5, 64, 0.5), new ArrayList<>());
        Player agent = player("ag_kestrel_01", at(overworld, 30.5, 64, 0.5), new ArrayList<>());
        Player human = player(at(overworld, 30.5, 64, 0.5), new ArrayList<>());
        ProbeWorld wall = new ProbeWorld()
                .set(10, 65, 0, ProbeWorld.solid("minecraft:stone"))
                .set(11, 65, 0, ProbeWorld.solid("minecraft:white_wool"));
        List<String> notices = new ArrayList<>();
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, agent, human)));

        listener(wall, notices).onChat(event);

        assertEquals(Set.of(speaker), new HashSet<>(event.viewers()));
        // The human has no life id, so no notice goes to it; the agent gets exactly one.
        assertEquals(List.of("ag_kestrel_01 w far"), notices);
    }

    @Test
    void aFailedHopSilencesEveryOtherPlayer() {
        World overworld = world("world");
        Player speaker = player(at(overworld, 0, 64, 0), new ArrayList<>());
        Player near = player(at(overworld, 3, 64, 0), new ArrayList<>());
        AsyncChatEvent event = chat(speaker, new HashSet<>(Set.of(speaker, near)));
        ProximityChatListener failing = new ProximityChatListener(
                work -> Set.of(), () -> 1L, w -> new ProbeWorld(),
                new ChatHearing(MuffleSettings.defaults(), line -> { }), (lifeId, direction, band) -> { });

        failing.onChat(event);

        assertEquals(Set.of(speaker), new HashSet<>(event.viewers()));
    }

    private static AsyncChatEvent chat(Player speaker, Set<Audience> viewers) {
        return new AsyncChatEvent(true, speaker, viewers, null, LINE, LINE, null);
    }
}
