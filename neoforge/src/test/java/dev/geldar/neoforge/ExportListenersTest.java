package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.InMemoryEventPublisher;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import net.neoforged.bus.api.Event;
import net.neoforged.neoforge.event.CommandEvent;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.entity.living.LivingDamageEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.CanPlayerSleepEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.junit.jupiter.api.Test;

/** Which NeoForge event types the export listens to, for an enabled and a disabled config. No event is fired. */
class ExportListenersTest {
    private static final Instant AT = Instant.parse("2026-11-17T12:00:00Z");

    /** Records each type that gets a listener. The handlers are never run, so nothing else is needed. */
    private static final class RecordingBus implements ExportListeners.Bus {
        final List<Class<?>> types = new ArrayList<>();

        @Override
        public <E extends Event> void listen(Class<E> type, Consumer<E> handler) {
            types.add(type);
        }
    }

    private static final class Quiet implements OperatorSink {
        @Override
        public void info(String message) {}

        @Override
        public void warn(String message) {}
    }

    private static ExportConfig config(boolean enabled) {
        return new ExportConfig(enabled, "nats://example.invalid:4222", "nf", null, null, 10);
    }

    private static ExportHandlers handlers(ExportConfig config) {
        Quiet sink = new Quiet();
        ExportLifecycle lifecycle = new ExportLifecycle(config, (c, log) -> new InMemoryEventPublisher(), sink);
        return new ExportHandlers(lifecycle, config.shard(), () -> AT, sink);
    }

    @Test
    void aDisabledExportRegistersNoListener() {
        ExportConfig off = config(false);
        RecordingBus bus = new RecordingBus();
        ExportListeners.install(off, bus, handlers(off), new Quiet());
        assertTrue(bus.types.isEmpty(), "a disabled export must leave the game bus untouched: " + bus.types);
    }

    @Test
    void anEnabledExportRegistersTheFiveListeners() {
        ExportConfig on = config(true);
        RecordingBus bus = new RecordingBus();
        ExportListeners.install(on, bus, handlers(on), new Quiet());
        assertEquals(
                List.of(
                        LivingDamageEvent.Post.class,
                        LivingDeathEvent.class,
                        CanPlayerSleepEvent.class,
                        ServerTickEvent.Pre.class,
                        ServerTickEvent.Post.class),
                bus.types);
    }

    @Test
    void anEnabledExportRegistersNoChatListener() {
        ExportConfig on = config(true);
        RecordingBus bus = new RecordingBus();
        ExportListeners.install(on, bus, handlers(on), new Quiet());
        assertFalse(bus.types.contains(ServerChatEvent.class), "chat is not exported: ServerChatEvent has a listener");
        assertFalse(
                bus.types.contains(CommandEvent.class),
                "chat is not exported, but a command event (/say, /me, /msg text) has a listener: " + bus.types);
        assertTrue(
                bus.types.stream().noneMatch(type -> type.getSimpleName().contains("Chat")),
                "chat is not exported, but a chat event type has a listener: " + bus.types);
    }

    @Test
    void anEnabledExportRegistersNoCommandListener() {
        ExportConfig on = config(true);
        RecordingBus bus = new RecordingBus();
        ExportListeners.install(on, bus, handlers(on), new Quiet());
        assertTrue(
                bus.types.stream().noneMatch(type -> type.getSimpleName().contains("Command")),
                "a command event carries /say, /me and /msg text, so no command listener may be registered: "
                        + bus.types);
    }
}
