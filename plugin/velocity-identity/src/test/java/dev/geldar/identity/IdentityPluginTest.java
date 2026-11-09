package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ServerConnection;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
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
    void logNamesAreShortAndPlain() {
        assertNotNull(IdentityPlugin.printable(null));
        assertEquals("a?b", IdentityPlugin.printable("a\nb"));
        assertEquals(32, IdentityPlugin.printable("x".repeat(100)).length());
    }
}
