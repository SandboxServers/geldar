package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.ScheduledTask;
import com.velocitypowered.api.scheduler.Scheduler;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** Drives the event handlers with Player doubles; no proxy runs. */
class IdentityPluginTest {
    private final IdentityPlugin plugin = new IdentityPlugin(null, NOPLogger.NOP_LOGGER);

    private static Player player(String name, UUID id) {
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> switch (m.getName()) {
            case "getUsername" -> name;
            case "getUniqueId" -> id;
            case "hashCode" -> id.hashCode();
            case "equals" -> p == a[0];
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    private static ServerConnection backend() {
        return (ServerConnection) Proxy.newProxyInstance(
                ServerConnection.class.getClassLoader(), new Class<?>[] {ServerConnection.class}, (p, m, a) -> null);
    }

    private void register(String name) throws Exception {
        var field = IdentityPlugin.class.getDeclaredField("registry");
        field.setAccessible(true);
        LifeRegistry registry = (LifeRegistry) field.get(plugin);
        if (!registry.isSynced()) {
            registry.beginReplay();
        }
        registry.put(name, "{\"life_id\":\"l\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8));
        registry.markSynced();
    }

    @Test
    void anUnregisteredLoginIsDeniedWithTheFixedMessage() {
        LoginEvent event = new LoginEvent(player("mallory", UUID.randomUUID()));
        plugin.onLogin(event);
        assertFalse(event.getResult().isAllowed());
        assertEquals(LoginGate.DENY_MESSAGE,
                net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                        .serialize(event.getResult().getReasonComponent().orElseThrow()));
    }

    @Test
    void aRegisteredLoginIsAdmittedAndOpensTheCommandChannel() throws Exception {
        register("alice");
        UUID id = UUID.randomUUID();
        Player alice = player("Alice", id);
        LoginEvent event = new LoginEvent(alice);
        plugin.onLogin(event);
        assertTrue(event.getResult().isAllowed());

        PluginMessageEvent message = new PluginMessageEvent(alice, backend(), IdentityPlugin.COMMAND_CHANNEL, new byte[0]);
        plugin.onPluginMessage(message);
        assertTrue(message.getResult().isAllowed());
    }

    @Test
    void theCommandChannelIsClosedToAConnectionThatWasNotAdmitted() {
        Player stranger = player("mallory", UUID.randomUUID());
        PluginMessageEvent message = new PluginMessageEvent(stranger, backend(), IdentityPlugin.COMMAND_CHANNEL, new byte[0]);
        plugin.onPluginMessage(message);
        assertFalse(message.getResult().isAllowed());
    }

    @Test
    void messagesFromTheBackendAreNotTouched() {
        ServerConnection server = backend();
        PluginMessageEvent message = new PluginMessageEvent(server, backend(), IdentityPlugin.COMMAND_CHANNEL, new byte[0]);
        plugin.onPluginMessage(message);
        assertTrue(message.getResult().isAllowed());
    }

    @Test
    void aDisconnectReleasesTheAdmissionAndClosesTheCommandChannel() throws Exception {
        register("alice");
        Player alice = player("Alice", UUID.randomUUID());
        plugin.onLogin(new LoginEvent(alice));
        plugin.onDisconnect(new DisconnectEvent(alice, DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));

        PluginMessageEvent message = new PluginMessageEvent(alice, backend(), IdentityPlugin.COMMAND_CHANNEL, new byte[0]);
        plugin.onPluginMessage(message);
        assertFalse(message.getResult().isAllowed());
    }

    @Test
    void aConflictingLoginDisconnectKeepsTheLiveSessionAdmitted() throws Exception {
        register("alice");
        UUID id = UUID.randomUUID();
        Player live = player("Alice", id);
        Player duplicate = player("Alice", id);
        plugin.onLogin(new LoginEvent(live));
        plugin.onLogin(new LoginEvent(duplicate));
        plugin.onDisconnect(new DisconnectEvent(duplicate, DisconnectEvent.LoginStatus.CONFLICTING_LOGIN));

        PluginMessageEvent message = new PluginMessageEvent(live, backend(), IdentityPlugin.COMMAND_CHANNEL, new byte[0]);
        plugin.onPluginMessage(message);
        assertTrue(message.getResult().isAllowed());
    }

    @Test
    void logNamesAreShortAndPlain() {
        assertNotNull(IdentityPlugin.printable(null));
        assertEquals("a?b", IdentityPlugin.printable("a\nb"));
        assertEquals(32, IdentityPlugin.printable("x".repeat(100)).length());
    }

    /** A proxy double that records the scheduler calls the plugin makes. */
    private static final class SchedulerLog {
        final List<String> built = new ArrayList<>();
        final AtomicInteger scheduled = new AtomicInteger();
        final AtomicInteger cancelled = new AtomicInteger();

        private static <T> T stub(Class<T> type, java.lang.reflect.InvocationHandler handler) {
            return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
        }

        ProxyServer proxy() {
            ScheduledTask task = stub(ScheduledTask.class, (p, m, a) -> {
                if (m.getName().equals("cancel")) {
                    cancelled.incrementAndGet();
                }
                return null;
            });
            Object[] builder = new Object[1];
            builder[0] = stub(Scheduler.TaskBuilder.class, (p, m, a) -> switch (m.getName()) {
                case "repeat" -> builder[0];
                case "schedule" -> {
                    scheduled.incrementAndGet();
                    yield task;
                }
                default -> throw new UnsupportedOperationException(m.getName());
            });
            Scheduler scheduler = stub(Scheduler.class, (p, m, a) -> {
                if (m.getName().equals("buildTask")) {
                    built.add("task");
                    return builder[0];
                }
                throw new UnsupportedOperationException(m.getName());
            });
            ChannelRegistrar registrar = stub(ChannelRegistrar.class, (p, m, a) -> null);
            return stub(ProxyServer.class, (p, m, a) -> switch (m.getName()) {
                case "getScheduler" -> scheduler;
                case "getChannelRegistrar" -> registrar;
                default -> throw new UnsupportedOperationException(m.getName());
            });
        }
    }

    @Test
    void theDenialSummaryIsScheduledEvenWhenTheNatsUrlIsMissing() {
        SchedulerLog schedules = new SchedulerLog();
        IdentityPlugin bare = new IdentityPlugin(schedules.proxy(), NOPLogger.NOP_LOGGER, () -> null);
        bare.onProxyInitialization(new ProxyInitializeEvent());
        assertEquals(1, schedules.built.size());
        assertEquals(1, schedules.scheduled.get());
        bare.onProxyShutdown(new ProxyShutdownEvent());
        assertEquals(1, schedules.cancelled.get(), "shutdown cancels the summary task");
    }}
