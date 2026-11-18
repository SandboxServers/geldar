package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.config.ProxyConfig;
import com.velocitypowered.api.proxy.messages.ChannelRegistrar;
import com.velocitypowered.api.scheduler.Scheduler;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.helpers.NOPLogger;

/** The human lane needs a valid GELDAR_NATS_INBOX_PREFIX before any registry client starts; the agent lane does not. */
class InboxPrefixRefusalTest {

    private static <T> T stub(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler));
    }

    /** A proxy whose registrar and scheduler accept every call; no proxy runs. */
    private static ProxyServer proxy(boolean onlineMode) {
        Scheduler.TaskBuilder[] builder = new Scheduler.TaskBuilder[1];
        builder[0] = stub(Scheduler.TaskBuilder.class, (p, m, a) -> m.getName().equals("schedule") ? null : builder[0]);
        Scheduler scheduler = stub(Scheduler.class, (p, m, a) -> builder[0]);
        ChannelRegistrar registrar = stub(ChannelRegistrar.class, (p, m, a) -> null);
        ProxyConfig config = stub(ProxyConfig.class, (p, m, a) -> "isOnlineMode".equals(m.getName()) ? onlineMode : null);
        return stub(ProxyServer.class, (p, m, a) -> switch (m.getName()) {
            case "getChannelRegistrar" -> registrar;
            case "getScheduler" -> scheduler;
            case "getConfiguration" -> config;
            default -> throw new UnsupportedOperationException(m.getName());
        });
    }

    /** A logger that keeps every argument it is given, so a test can read everything the plugin logged. */
    private static Logger capturingLog(List<String> seen) {
        return stub(Logger.class, (p, m, a) -> {
            if (a != null) {
                for (Object arg : a) {
                    seen.add(Arrays.deepToString(new Object[] {arg}));
                }
            }
            return m.getReturnType() == boolean.class ? Boolean.FALSE : null;
        });
    }

    /** The online-mode human or agent plugin under test; a null URL keeps every registry client from starting. */
    private static IdentityPlugin plugin(Logger log, String lane, String prefix) {
        return new IdentityPlugin(proxy(true), log, () -> null, new SkinRegistry(log),
                ReadyMarker.forThisProcess(IdentityPlugin.READY_FILE), () -> lane, () -> prefix);
    }

    private static boolean refused(IdentityPlugin plugin) throws Exception {
        Field field = IdentityPlugin.class.getDeclaredField("refused");
        field.setAccessible(true);
        return (boolean) field.get(plugin);
    }

    @Test
    void theHumanLaneWithAMalformedPrefixIsRefusedAndNotReady() throws Exception {
        IdentityPlugin plugin = new IdentityPlugin(proxy(true), NOPLogger.NOP_LOGGER, () -> "nats://127.0.0.1:4222",
                new SkinRegistry(NOPLogger.NOP_LOGGER), ReadyMarker.forThisProcess(IdentityPlugin.READY_FILE), () -> "human",
                () -> "_INBOX.>");
        plugin.onProxyInitialization(new ProxyInitializeEvent());
        assertTrue(refused(plugin), "a malformed prefix must refuse the lane");
    }

    @Test
    void theHumanLaneWithAnUnsetOrBlankPrefixIsRefusedBeforeAnyClient() throws Exception {
        for (String prefix : new String[] {null, "", "   "}) {
            List<String> seen = new ArrayList<>();
            IdentityPlugin plugin = plugin(capturingLog(seen), "human", prefix);
            plugin.onProxyInitialization(new ProxyInitializeEvent());
            assertTrue(refused(plugin), "the human lane with prefix [" + prefix + "] must be refused");
            assertTrue(seen.stream().anyMatch(s -> s.contains("GELDAR_NATS_INBOX_PREFIX must be set on the human lane")),
                    "the refusal must name the setting");
            assertFalse(seen.stream().anyMatch(s -> s.contains("GELDAR_NATS_URL is not set")),
                    "the refusal must stop before the registry path");
        }
    }

    @Test
    void theHumanLaneWithAValidPrefixIsNotRefusedAndProceeds() throws Exception {
        List<String> seen = new ArrayList<>();
        IdentityPlugin plugin = plugin(capturingLog(seen), "human", "_INBOX.human.");
        plugin.onProxyInitialization(new ProxyInitializeEvent());
        assertFalse(refused(plugin), "a valid human prefix must not refuse the lane");
        assertTrue(seen.stream().anyMatch(s -> s.contains("GELDAR_NATS_URL is not set")),
                "the init must proceed past the prefix check to the registry path");
    }

    @Test
    void theAgentLaneWithAnUnsetPrefixIsUnchanged() throws Exception {
        List<String> seen = new ArrayList<>();
        IdentityPlugin plugin = plugin(capturingLog(seen), "agent", null);
        plugin.onProxyInitialization(new ProxyInitializeEvent());
        assertFalse(refused(plugin), "the agent lane does not require the prefix");
        assertTrue(seen.stream().anyMatch(s -> s.contains("GELDAR_NATS_URL is not set")),
                "the agent lane proceeds to the registry path");
    }

    @Test
    void aMalformedPrefixNeverAppearsInTheRefusalOrAnyLogRecord() throws Exception {
        for (String bad : new String[] {"_INBOX.S3cr3t b.", "x_INBOX.S3cr3t.", "S3cr3t."}) {
            List<String> seen = new ArrayList<>();
            IdentityPlugin plugin = plugin(capturingLog(seen), "human", bad);
            plugin.onProxyInitialization(new ProxyInitializeEvent());
            assertTrue(refused(plugin), bad);
            assertTrue(seen.stream().anyMatch(s -> s.contains("GELDAR_NATS_INBOX_PREFIX")), "the refusal names the setting");
            for (String record : seen) {
                assertFalse(record.contains("S3cr3t"), "a log record leaked the configured value: " + record);
            }
        }
    }
}
