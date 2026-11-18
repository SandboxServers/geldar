package dev.geldar.identity;

import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.config.ProxyConfig;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.Scheduler;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.helpers.NOPLogger;

/**
 * Builds the plugin for a human-lane test, with a Velocity proxy double that reports the online mode it is given.
 * The readiness marker goes to a temporary directory and the NATS URL is unset, so no network is touched.
 * Each login uses its own {@link Player} object, as Velocity does: a second login of a UUID is a different connection.
 */
final class IdentityPluginFixture {
    private final IdentityPlugin plugin;
    private final Path marker;
    /** The first connection each UUID logged in on, so {@link #disconnect(UUID, DisconnectEvent.LoginStatus)} names the holder. */
    private final Map<UUID, Player> firstLogin = new ConcurrentHashMap<>();
    private volatile String lastDeny;

    IdentityPluginFixture(Path dir, String lane, boolean onlineMode) {
        this(dir, lane, onlineMode, NOPLogger.NOP_LOGGER);
    }

    /** Takes the logger too, so a test can read what the plugin logs. */
    IdentityPluginFixture(Path dir, String lane, boolean onlineMode, Logger log) {
        this.marker = dir.resolve("geldar-identity.ready");
        this.plugin = new IdentityPlugin(proxy(onlineMode), log, () -> null,
                new SkinRegistry(log), new ReadyMarker(marker, () -> "1 2"), () -> lane);
    }

    void init() {
        plugin.onProxyInitialization(null);
    }

    /** Marks the registry synced, as a healthy NATS sync would. No NATS runs in these tests. */
    void syncRegistry() {
        plugin.registry().beginReplay();
        plugin.registry().markSynced();
    }

    /** Marks the registry unsynced, as a registry error or a lost sync would. */
    void unsyncRegistry() {
        plugin.registry().markUnsynced();
    }

    Path marker() {
        return marker;
    }

    /** Runs one login and returns whether it was allowed; a refusal keeps its plain-text reason for {@link #lastDenyMessage}. */
    boolean loginAllowed(String name, UUID id) {
        return allowed(login(name, id));
    }

    /** Whether this login's result allowed it. A refusal keeps its plain-text reason for {@link #lastDenyMessage}. */
    boolean allowed(LoginEvent event) {
        if (!event.getResult().isAllowed()) {
            lastDeny = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                    .serialize(event.getResult().getReasonComponent().orElseThrow());
        }
        return event.getResult().isAllowed();
    }

    String lastDenyMessage() {
        return lastDeny;
    }

    /** Runs the login handler for a new connection of this name and UUID, and returns its event so it can be settled later. */
    LoginEvent login(String name, UUID id) {
        Player player = newPlayer(name, id);
        firstLogin.putIfAbsent(id, player);
        return login(player);
    }

    /** Runs the login handler for one connection object. */
    LoginEvent login(Player player) {
        LoginEvent event = new LoginEvent(player);
        plugin.onLogin(event);
        return event;
    }

    /** A new connection object (a distinct Velocity player) for this name and UUID. */
    Player newPlayer(String name, UUID id) {
        return player(name, id);
    }

    /** Runs the last-ordered login handler, as Velocity does once every handler has seen the event. */
    void settle(LoginEvent event) {
        plugin.onLoginSettled(event);
    }

    /** Runs the disconnect handler for the first connection of this UUID: the one that holds its slot. */
    void disconnect(UUID id, DisconnectEvent.LoginStatus status) {
        disconnect(firstLogin.getOrDefault(id, player("", id)), status);
    }

    /** Runs the disconnect handler for one connection object, whatever status Velocity reports for it. */
    void disconnect(Player player, DisconnectEvent.LoginStatus status) {
        plugin.onDisconnect(new DisconnectEvent(player, status));
    }

    private static Player player(String name, UUID id) {
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> switch (m.getName()) {
            case "getUsername" -> name;
            case "getUniqueId" -> id;
            case "hashCode" -> id.hashCode();
            case "equals" -> p == a[0];
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    /** A proxy whose only live answers are the channel registrar, the scheduler and the online mode. */
    private static ProxyServer proxy(boolean onlineMode) {
        ChannelRegistrar registrar = stub(ChannelRegistrar.class, (p, m, a) -> null);
        Scheduler.TaskBuilder builder = stub(Scheduler.TaskBuilder.class,(p, m, a) -> "repeat".equals(m.getName()) ? p : null);
        Scheduler scheduler = stub(Scheduler.class, (p, m, a) -> "buildTask".equals(m.getName()) ? builder : null);
        ProxyConfig config = stub(ProxyConfig.class, (p, m, a) -> "isOnlineMode".equals(m.getName()) ? onlineMode : null);
        return stub(ProxyServer.class, (p, m, a) -> switch (m.getName()) {
            case "getChannelRegistrar" -> registrar;
            case "getScheduler" -> scheduler;
            case "getConfiguration" -> config;
            // The already-connected check asks for the name: nobody is connected in these tests.
            case "getPlayer" -> Optional.empty();
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    private static <T> T stub(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
    }
}
