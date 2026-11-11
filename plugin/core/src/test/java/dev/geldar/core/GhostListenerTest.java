package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.papermc.paper.event.player.AsyncChatEvent;
import com.destroystokyo.paper.profile.PlayerProfile;
import com.destroystokyo.paper.profile.ProfileProperty;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.junit.jupiter.api.Test;

class GhostListenerTest {
    /** A live-marked Player whose game mode is held in {@code mode[0]}; setGameMode writes it. */
    private static Player player(UUID id, GameMode[] mode) {
        return player(id, mode, true, new ArrayList<>(), false);
    }

    /** A joiner without the live property: what a ghost looks like when it arrives. */
    private static Player unmarked(UUID id, GameMode[] mode) {
        return player(id, mode, false, new ArrayList<>(), false);
    }

    private static Player player(UUID id, GameMode[] mode, boolean live, List<String> events, boolean refuseMode) {
        Set<ProfileProperty> properties = live ? Set.of(new ProfileProperty(GhostListener.LIVE_PROPERTY, "1")) : Set.of();
        PlayerProfile profile = (PlayerProfile) Proxy.newProxyInstance(
                GhostListenerTest.class.getClassLoader(),
                new Class<?>[] {PlayerProfile.class},
                (p, m, a) -> m.getName().equals("getProperties") ? properties : null);
        return (Player) Proxy.newProxyInstance(
                GhostListenerTest.class.getClassLoader(),
                new Class<?>[] {Player.class},
                (p, m, a) -> switch (m.getName()) {
                    case "getUniqueId" -> id;
                    case "getPlayerProfile" -> profile;
                    case "getGameMode" -> mode[0];
                    case "setGameMode" -> {
                        if (refuseMode) {
                            throw new IllegalStateException("refused");
                        }
                        events.add("mode");
                        mode[0] = (GameMode) a[0];
                        yield null;
                    }
                    case "kick" -> {
                        events.add("kick");
                        yield null;
                    }
                    case "hashCode" -> id.hashCode();
                    case "equals" -> p == a[0];
                    default -> null;
                });
    }

    private static GhostListener listener() {
        return new GhostListener(Logger.getLogger("test"));
    }

    private static void signal(GhostListener l, Player p) {
        l.onPluginMessageReceived(GhostListener.CHANNEL, p, new byte[] {1});
    }

    private static AsyncChatEvent chat(Player p) {
        return new AsyncChatEvent(true, p, Set.of(), null, Component.text("hi"), Component.text("hi"), null);
    }

    @Test
    void theSignalForcesSpectatorAndMarksTheGhost() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        signal(l, p);
        assertEquals(GameMode.SPECTATOR, mode[0]);
        assertTrue(l.isGhost(p));
    }

    @Test
    void anotherChannelOrAnUnsignalledPlayerIsLeftAlone() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        l.onPluginMessageReceived("geldar:cmd", p, new byte[] {1});
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        l.onWorldChange(new PlayerChangedWorldEvent(p, null));
        assertEquals(GameMode.SURVIVAL, mode[0]);
        assertFalse(l.isGhost(p));
    }

    @Test
    void aWorldChangeAndAJoinReapplySpectator() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        signal(l, p);
        mode[0] = GameMode.CREATIVE;
        l.onWorldChange(new PlayerChangedWorldEvent(p, null));
        assertEquals(GameMode.SPECTATOR, mode[0]);
        mode[0] = GameMode.SURVIVAL;
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        assertEquals(GameMode.SPECTATOR, mode[0]);
    }

    @Test
    void aGameModeChangeAwayFromSpectatorIsCancelledForAGhostOnly() {
        GameMode[] ghostMode = {GameMode.SURVIVAL};
        GameMode[] liveMode = {GameMode.SURVIVAL};
        Player ghost = player(UUID.randomUUID(), ghostMode);
        Player live = player(UUID.randomUUID(), liveMode);
        GhostListener l = listener();
        signal(l, ghost);

        var away = new PlayerGameModeChangeEvent(
                ghost, GameMode.CREATIVE, PlayerGameModeChangeEvent.Cause.PLUGIN, null);
        l.onGameModeChange(away);
        assertTrue(away.isCancelled());

        var toSpectator = new PlayerGameModeChangeEvent(
                ghost, GameMode.SPECTATOR, PlayerGameModeChangeEvent.Cause.PLUGIN, null);
        l.onGameModeChange(toSpectator);
        assertFalse(toSpectator.isCancelled());

        var liveChange = new PlayerGameModeChangeEvent(
                live, GameMode.CREATIVE, PlayerGameModeChangeEvent.Cause.PLUGIN, null);
        l.onGameModeChange(liveChange);
        assertFalse(liveChange.isCancelled());
    }

    @Test
    void aGhostsChatIsCancelledAndALivePlayersIsNot() {
        Player ghost = player(UUID.randomUUID(), new GameMode[] {GameMode.SURVIVAL});
        Player live = player(UUID.randomUUID(), new GameMode[] {GameMode.SURVIVAL});
        GhostListener l = listener();
        signal(l, ghost);

        AsyncChatEvent ghostChat = chat(ghost);
        l.onChat(ghostChat);
        assertTrue(ghostChat.isCancelled());

        AsyncChatEvent liveChat = chat(live);
        l.onChat(liveChat);
        assertFalse(liveChat.isCancelled());
    }

    @Test
    void quitForgetsTheGhostAndAFailingSetGameModeNeverThrows() {
        GameMode[] mode = {GameMode.SURVIVAL};
        UUID id = UUID.randomUUID();
        Player p = player(id, mode);
        GhostListener l = listener();
        signal(l, p);
        l.onQuit(new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        assertFalse(l.isGhost(p));

        UUID brokenId = UUID.randomUUID();
        Player broken = player(brokenId, new GameMode[] {GameMode.SURVIVAL}, true, new ArrayList<>(), true);
        signal(l, broken);
        assertTrue(l.isGhost(broken));
    }

    @Test
    void aRespawnReappliesSpectatorForAGhostOnly() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player ghost = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        signal(l, ghost);
        mode[0] = GameMode.SURVIVAL;
        l.onRespawn(new PlayerRespawnEvent(ghost, null, false));
        assertEquals(GameMode.SPECTATOR, mode[0]);

        GameMode[] liveMode = {GameMode.SURVIVAL};
        Player live = player(UUID.randomUUID(), liveMode);
        l.onRespawn(new PlayerRespawnEvent(live, null, false));
        assertEquals(GameMode.SURVIVAL, liveMode[0]);
    }

    @Test
    void aJoinerWithoutTheLivePropertyIsASpectatorAtTheFirstJoinEvent() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = unmarked(UUID.randomUUID(), mode);
        GhostListener l = listener();
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        assertEquals(GameMode.SPECTATOR, mode[0]);
        assertTrue(l.isGhost(p));
    }

    @Test
    void theJoinHandlerRunsFirstSoNoOtherHandlerSeesASurvivalGhost() throws Exception {
        var handler = GhostListener.class.getMethod("onJoin", PlayerJoinEvent.class)
                .getAnnotation(org.bukkit.event.EventHandler.class);
        assertEquals(org.bukkit.event.EventPriority.LOWEST, handler.priority());
    }

    @Test
    void aJoinerWithTheLivePropertyIsUntouched() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        assertEquals(GameMode.SURVIVAL, mode[0]);
        assertFalse(l.isGhost(p));
    }

    @Test
    void theSignalStillWinsOverTheLiveProperty() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = player(UUID.randomUUID(), mode);
        GhostListener l = listener();
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        signal(l, p);
        assertEquals(GameMode.SPECTATOR, mode[0]);
        assertTrue(l.isGhost(p));
    }

    @Test
    void aHoldFailureKicksTheGhostOnJoinAndOnTheSignal() {
        List<String> events = new ArrayList<>();
        Player joiner = player(UUID.randomUUID(), new GameMode[] {GameMode.SURVIVAL}, false, events, true);
        GhostListener l = listener();
        l.onJoin(new PlayerJoinEvent(joiner, Component.empty()));
        assertEquals(List.of("kick"), events);

        List<String> signalEvents = new ArrayList<>();
        Player signalled = player(UUID.randomUUID(), new GameMode[] {GameMode.SURVIVAL}, true, signalEvents, true);
        signal(l, signalled);
        assertEquals(List.of("kick"), signalEvents);
    }

    @Test
    void aSuccessfulHoldNeverKicks() {
        List<String> events = new ArrayList<>();
        Player p = player(UUID.randomUUID(), new GameMode[] {GameMode.SURVIVAL}, false, events, false);
        listener().onJoin(new PlayerJoinEvent(p, Component.empty()));
        assertEquals(List.of("mode"), events);
    }

    @Test
    void anUnreadableProfileIsAGhost() {
        GameMode[] mode = {GameMode.SURVIVAL};
        Player p = (Player) Proxy.newProxyInstance(
                GhostListenerTest.class.getClassLoader(), new Class<?>[] {Player.class},
                (pr, m, a) -> switch (m.getName()) {
                    case "getUniqueId" -> UUID.nameUUIDFromBytes(new byte[] {1});
                    case "getPlayerProfile" -> throw new IllegalStateException("no profile");
                    case "getGameMode" -> mode[0];
                    case "setGameMode" -> {
                        mode[0] = (GameMode) a[0];
                        yield null;
                    }
                    default -> null;
                });
        GhostListener l = listener();
        l.onJoin(new PlayerJoinEvent(p, Component.empty()));
        assertEquals(GameMode.SPECTATOR, mode[0]);
    }
}
