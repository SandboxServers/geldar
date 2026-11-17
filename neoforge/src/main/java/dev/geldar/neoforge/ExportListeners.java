package dev.geldar.neoforge;

import java.time.Instant;
import java.util.function.Consumer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.Event;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.living.LivingDamageEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.CanPlayerSleepEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Registers the export listeners when, and only when, the export is enabled. Each listener reads one NeoForge event
 * through {@link NeoForgeFacts} and calls {@link ExportHandlers}; nothing here blocks or waits on the network.
 * The drops event is not listened to yet: its ordering against the death event is UNVERIFIED (README).
 */
public final class ExportListeners {
    /** The bus, behind an interface so a test can count registrations without a server. */
    public interface Bus {
        <E extends Event> void listen(Class<E> type, Consumer<E> handler);
    }

    private ExportListeners() {}

    /** The real NeoForge game bus. */
    public static Bus neoForgeBus() {
        return new Bus() {
            @Override
            public <E extends Event> void listen(Class<E> type, Consumer<E> handler) {
                NeoForge.EVENT_BUS.addListener(handler);
            }
        };
    }

    /**
     * Registers the five listeners if the export is enabled. A disabled export registers nothing, so the server
     * runs with no export hooks at all.
     */
    public static void install(ExportConfig config, Bus bus, ExportHandlers handlers, OperatorSink sink) {
        if (!config.enabled()) {
            return;
        }
        bus.listen(LivingDamageEvent.Post.class, guarded(sink, "damage", event -> {
            if (event.getEntity() instanceof ServerPlayer player) {
                handlers.damage(
                        NeoForgeFacts.playerName(player),
                        NeoForgeFacts.causeOf(event.getSource()),
                        event.getInflictedDamage());
            }
        }));
        bus.listen(LivingDeathEvent.class, guarded(sink, "death", event -> {
            if (event.getEntity() instanceof ServerPlayer player) {
                handlers.death(
                        NeoForgeFacts.playerName(player),
                        NeoForgeFacts.causeOf(event.getSource()),
                        NeoForgeFacts.blockPos(player),
                        NeoForgeFacts.dimensionId(player));
            }
        }));
        bus.listen(CanPlayerSleepEvent.class, guarded(sink, "sleep", event -> {
            if (event.getProblem() == null) {
                handlers.sleep(NeoForgeFacts.playerName(event.getEntity()));
            }
        }));
        bus.listen(ServerTickEvent.Pre.class, guarded(sink, "tick", event -> handlers.tickStart(System.nanoTime())));
        bus.listen(ServerTickEvent.Post.class, guarded(sink, "tick", event -> handlers.tickEnd(
                System.nanoTime(), NeoForgeFacts.serverTick(event.getServer()),
                NeoForgeFacts.playerCount(event.getServer()))));
    }

    /** The handler set for a started lifecycle: the real clock, and the warnings to the operator log. */
    public static ExportHandlers handlersFor(ExportConfig config, ExportLifecycle lifecycle, OperatorSink sink) {
        return new ExportHandlers(lifecycle, config.shard(), Instant::now, sink);
    }

    /** Wraps a listener so an exception in it is logged and never reaches the game bus. */
    private static <E> Consumer<E> guarded(OperatorSink sink, String name, Consumer<E> handler) {
        return event -> {
            try {
                handler.accept(event);
            } catch (RuntimeException e) {
                sink.warn("geldar_neoforge " + name + " listener failed (" + e.getClass().getSimpleName() + ")");
            }
        };
    }
}
