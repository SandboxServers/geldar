package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.proxy.InboundConnection;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.ChannelIdentifier;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.ScheduledTask;
import com.velocitypowered.api.scheduler.Scheduler;
import com.velocitypowered.api.util.GameProfile;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** The Velocity side of the ghost wiring (decisions 0092, 0137): the live property, the signal, and its failure paths. */
class GhostWiringTest {
    private static final byte[] LIVE = "{\"life_id\":\"l1\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8);
    private static final byte[] GHOST = "{\"life_id\":\"l2\",\"registered_at\":\"t\",\"live\":false}".getBytes(StandardCharsets.UTF_8);

    private static <T> T stub(Class<T> type, java.lang.reflect.InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
    }

    private final List<String> disconnects = new ArrayList<>();
    private final List<byte[]> sent = new ArrayList<>();
    private final List<ChannelIdentifier> sentOn = new ArrayList<>();

    private IdentityPlugin pluginWith(ProxyServer proxy) throws Exception {
        IdentityPlugin plugin = new IdentityPlugin(proxy, NOPLogger.NOP_LOGGER, () -> null);
        var field = IdentityPlugin.class.getDeclaredField("registry");
        field.setAccessible(true);
        LifeRegistry registry = (LifeRegistry) field.get(plugin);
        registry.beginReplay();
        registry.put("alice", LIVE);
        registry.put("ghost", GHOST);
        registry.markSynced();
        return plugin;
    }

    private Player player(String name, UUID id, Optional<ServerConnection> server) {
        return stub(Player.class, (p, m, a) -> switch (m.getName()) {
            case "getUsername" -> name;
            case "getUniqueId" -> id;
            case "getCurrentServer" -> server;
            case "disconnect" -> {
                disconnects.add(PlainTextComponentSerializer.plainText().serialize((Component) a[0]));
                yield null;
            }
            case "hashCode" -> id.hashCode();
            case "equals" -> p == a[0];
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    private ServerConnection backend(boolean accepts) {
        return stub(ServerConnection.class, (p, m, a) -> {
            if (m.getName().equals("sendPluginMessage")) {
                sentOn.add((ChannelIdentifier) a[0]);
                sent.add((byte[]) a[1]);
                return accepts;
            }
            return null;
        });
    }

    private static ServerPostConnectEvent connected(Player player) {
        return new ServerPostConnectEvent(player, null);
    }

    @Test
    void aSpectatorGetsExactlyOneSignalOnTheGhostChannel() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        Player ghost = player("ghost", UUID.randomUUID(), Optional.of(backend(true)));
        plugin.onLogin(new LoginEvent(ghost));
        plugin.onServerPostConnect(connected(ghost));
        assertEquals(1, sent.size());
        assertEquals("geldar:ghost", sentOn.get(0).getId());
        assertArrayEquals(new byte[] {1}, sent.get(0));
        assertTrue(disconnects.isEmpty());
    }

    @Test
    void aLiveLoginGetsNoSignal() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        Player alice = player("alice", UUID.randomUUID(), Optional.of(backend(true)));
        plugin.onLogin(new LoginEvent(alice));
        plugin.onServerPostConnect(connected(alice));
        assertTrue(sent.isEmpty());
        assertTrue(disconnects.isEmpty());
    }

    @Test
    void aSignalThatCannotBeSentDisconnectsTheGhostWithTheGenericMessage() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        Player ghost = player("ghost", UUID.randomUUID(), Optional.of(backend(false)));
        plugin.onLogin(new LoginEvent(ghost));
        plugin.onServerPostConnect(connected(ghost));
        assertEquals(List.of(LoginGate.DENY_MESSAGE), disconnects);
    }

    @Test
    void aGhostWithNoBackendIsDisconnected() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        Player ghost = player("ghost", UUID.randomUUID(), Optional.empty());
        plugin.onLogin(new LoginEvent(ghost));
        plugin.onServerPostConnect(connected(ghost));
        assertEquals(List.of(LoginGate.DENY_MESSAGE), disconnects);
        assertTrue(sent.isEmpty());
    }

    @Test
    void initialisationRegistersTheGhostChannelAndTheCommandChannel() {
        List<ChannelIdentifier> registered = new ArrayList<>();
        ChannelRegistrar registrar = stub(ChannelRegistrar.class, (p, m, a) -> {
            if (m.getName().equals("register")) {
                registered.addAll(List.of((ChannelIdentifier[]) a[0]));
            }
            return null;
        });
        ScheduledTask task = stub(ScheduledTask.class, (p, m, a) -> null);
        Object[] builder = new Object[1];
        builder[0] = stub(Scheduler.TaskBuilder.class, (p, m, a) -> m.getName().equals("schedule") ? task : builder[0]);
        Scheduler scheduler = stub(Scheduler.class, (p, m, a) -> builder[0]);
        ProxyServer proxy = stub(ProxyServer.class, (p, m, a) -> switch (m.getName()) {
            case "getChannelRegistrar" -> registrar;
            case "getScheduler" -> scheduler;
            default -> throw new UnsupportedOperationException(m.getName());
        });
        new IdentityPlugin(proxy, NOPLogger.NOP_LOGGER, () -> null).onProxyInitialization(new ProxyInitializeEvent());
        assertTrue(registered.contains(IdentityPlugin.GHOST_CHANNEL));
        assertTrue(registered.contains(IdentityPlugin.COMMAND_CHANNEL));
    }

    @Test
    void theChannelAndPropertyNamesMatchGeldarCore() throws IOException {
        String core = Files.readString(Path.of("..", "core", "src", "main", "java", "dev", "geldar", "core", "GhostListener.java"));
        assertEquals(IdentityPlugin.GHOST_CHANNEL.getId(), constant(core, "CHANNEL"));
        assertEquals(IdentityPlugin.LIVE_PROPERTY, constant(core, "LIVE_PROPERTY"));
    }

    private static String constant(String source, String name) {
        Matcher m = Pattern.compile("String " + name + " = \"([^\"]+)\";").matcher(source);
        assertTrue(m.find(), name + " not found in GhostListener.java");
        return m.group(1);
    }

    private static GameProfileRequestEvent request(String name, GameProfile.Property... extra) {
        GameProfile profile = GameProfile.forOfflinePlayer(name);
        List<GameProfile.Property> properties = new ArrayList<>(profile.getProperties());
        properties.addAll(List.of(extra));
        InboundConnection connection = stub(InboundConnection.class, (p, m, a) -> m.getReturnType() == boolean.class ? false : null);
        return new GameProfileRequestEvent(connection, profile.withProperties(properties), false);
    }

    private static List<GameProfile.Property> marks(GameProfileRequestEvent event) {
        return event.getGameProfile().getProperties().stream()
                .filter(p -> IdentityPlugin.LIVE_PROPERTY.equals(p.getName())).toList();
    }

    @Test
    void aLiveLoginGetsTheLivePropertyAndNoOtherLoginDoes() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        GameProfileRequestEvent live = request("alice");
        plugin.onGameProfile(live);
        assertEquals(1, marks(live).size());
        assertEquals(IdentityPlugin.LIVE_VALUE, marks(live).get(0).getValue());

        GameProfileRequestEvent ghost = request("ghost");
        plugin.onGameProfile(ghost);
        assertTrue(marks(ghost).isEmpty());

        GameProfileRequestEvent stranger = request("mallory");
        plugin.onGameProfile(stranger);
        assertTrue(marks(stranger).isEmpty());
    }

    @Test
    void aMarkTheClientSuppliedIsStrippedFromANonLiveLogin() throws Exception {
        IdentityPlugin plugin = pluginWith(null);
        GameProfileRequestEvent forged = request("mallory", new GameProfile.Property(IdentityPlugin.LIVE_PROPERTY, "1", ""));
        plugin.onGameProfile(forged);
        assertTrue(marks(forged).isEmpty());
        GameProfileRequestEvent forgedGhost = request("ghost", new GameProfile.Property(IdentityPlugin.LIVE_PROPERTY, "1", ""));
        plugin.onGameProfile(forgedGhost);
        assertFalse(marks(forgedGhost).size() > 0);
    }

    @Test
    void aNameAlreadyConnectedIsDeniedWithTheSameMessageAsAnUnknownName() throws Exception {
        Player first = player("alice", UUID.randomUUID(), Optional.empty());
        ProxyServer proxy = stub(ProxyServer.class, (p, m, a) -> m.getName().equals("getPlayer")
                ? Optional.of(first) : null);
        IdentityPlugin plugin = pluginWith(proxy);
        Player second = player("alice", UUID.randomUUID(), Optional.empty());
        LoginEvent event = new LoginEvent(second);
        plugin.onLogin(event);
        assertFalse(event.getResult().isAllowed());
        assertEquals(LoginGate.DENY_MESSAGE,
                PlainTextComponentSerializer.plainText().serialize(event.getResult().getReasonComponent().orElseThrow()));
        plugin.onServerPostConnect(connected(second));
        assertTrue(sent.isEmpty(), "a denied duplicate was never admitted");
    }
}
