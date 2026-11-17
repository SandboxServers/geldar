package dev.geldar.identity;

import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.config.ProxyConfig;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.Scheduler;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.helpers.NOPLogger;

/**
 * Builds the plugin for a human-lane test, with a Velocity proxy double that reports the online mode it is given.
 * The readiness marker goes to a temporary directory and the NATS URL is unset, so no network is touched.
 */
final class IdentityPluginFixture {
    private final IdentityPlugin plugin;
    private final Path marker;
    private String lastDeny;

    IdentityPluginFixture(Path dir, String lane, boolean onlineMode) {
        this.marker = dir.resolve("geldar-identity.ready");
        this.plugin = new IdentityPlugin(proxy(onlineMode), NOPLogger.NOP_LOGGER, () -> null,
                new SkinRegistry(NOPLogger.NOP_LOGGER), new ReadyMarker(marker, () -> "1 2"), () -> lane);
    }

    void init() {
        plugin.onProxyInitialization(null);
    }

    Path marker() {
        return marker;
    }

    /** Runs one login and returns whether it was allowed; a refusal keeps its plain-text reason for {@link #lastDenyMessage}. */
    boolean loginAllowed(String name, UUID id) {
        LoginEvent event = new LoginEvent(player(name, id));
        plugin.onLogin(event);
        if (!event.getResult().isAllowed()) {
            lastDeny = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                    .serialize(event.getResult().getReasonComponent().orElseThrow());
        }
        return event.getResult().isAllowed();
    }

    String lastDenyMessage() {
        return lastDeny;
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
