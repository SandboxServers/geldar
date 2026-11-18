package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.Scheduler;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** A malformed GELDAR_NATS_INBOX_PREFIX refuses the human lane before any registry client starts. */
class InboxPrefixRefusalTest {

    private static <T> T stub(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
    }

    /** A proxy whose registrar and scheduler accept every call; no proxy runs. */
    private static ProxyServer proxy() {
        Scheduler.TaskBuilder[] builder = new Scheduler.TaskBuilder[1];
        builder[0] = stub(Scheduler.TaskBuilder.class, (p, m, a) -> m.getName().equals("schedule") ? null : builder[0]);
        Scheduler scheduler = stub(Scheduler.class, (p, m, a) -> builder[0]);
        ChannelRegistrar registrar = stub(ChannelRegistrar.class, (p, m, a) -> null);
        return stub(ProxyServer.class, (p, m, a) -> switch (m.getName()) {
            case "getChannelRegistrar" -> registrar;
            case "getScheduler" -> scheduler;
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    private static boolean refused(IdentityPlugin plugin) throws Exception {
        Field field = IdentityPlugin.class.getDeclaredField("refused");
        field.setAccessible(true);
        return (boolean) field.get(plugin);
    }

    @Test
    void theHumanLaneWithAMalformedPrefixIsRefusedAndNotReady() throws Exception {
        IdentityPlugin plugin = new IdentityPlugin(proxy(), NOPLogger.NOP_LOGGER, () -> "nats://127.0.0.1:4222",
                new SkinRegistry(NOPLogger.NOP_LOGGER), ReadyMarker.forThisProcess(IdentityPlugin.READY_FILE), () -> "human",
                () -> "_INBOX.>");
        plugin.onProxyInitialization(new ProxyInitializeEvent());
        assertTrue(refused(plugin), "a malformed prefix must refuse the lane");
    }
}
