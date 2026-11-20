package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.event.Listener;
import org.bukkit.plugin.messaging.Messenger;
import org.junit.jupiter.api.Test;

/** JavaPlugin cannot be built without a server, so the wiring that onEnable registers is tested directly. */
class GeldarCoreTest {
    @Test
    void enableRegistersTheExporterAndTheCommandBlockButNotTheRecipeGrantByDefault() {
        EventExporter exporter = exporter();
        List<Listener> listeners = GeldarCore.listeners(exporter, Logger.getLogger("test"), false);

        assertEquals(3, listeners.size());
        assertTrue(listeners.stream().anyMatch(l -> l instanceof GhostListener));
        assertTrue(listeners.contains(exporter));
        assertTrue(listeners.stream().anyMatch(l -> l instanceof CommandBlockListener));
        assertTrue(listeners.stream().noneMatch(l -> l instanceof RecipeGrantListener));
    }

    @Test
    void theRecipeGrantIsRegisteredWhenTheFlagIsSet() {
        List<Listener> listeners = GeldarCore.listeners(exporter(), Logger.getLogger("test"), true);

        assertEquals(4, listeners.size());
        assertTrue(listeners.stream().anyMatch(l -> l instanceof RecipeGrantListener));
    }

    private static EventExporter exporter() {
        return new EventExporter(
                new InMemoryEventPublisher(), "phase0", () -> 0, Instant::now, Logger.getLogger("test"));
    }

    @Test
    void enablingOpensTheIncomingGhostChannelForTheGhostListenerOnly() {
        List<String> calls = new java.util.ArrayList<>();
        Messenger messenger = (Messenger) java.lang.reflect.Proxy.newProxyInstance(
                Messenger.class.getClassLoader(), new Class<?>[] {Messenger.class}, (p, m, a) -> {
                    if (m.getName().equals("registerIncomingPluginChannel")) {
                        calls.add(a[1] + "|" + (a[2] instanceof GhostListener));
                    }
                    return null;
                });
        GeldarCore.registerChannels(messenger, null, GeldarCore.listeners(exporter(), Logger.getLogger("test"), true));
        assertEquals(List.of("geldar:ghost|true"), calls);
    }

    @Test
    void aFailedEnableReleasesWhatItStartedThenStopsTheServer() {
        List<String> calls = new java.util.ArrayList<>();
        GeldarCore.enableOrStop(
                () -> {
                    throw new IllegalStateException("bad config");
                },
                () -> calls.add("disable"),
                () -> calls.add("shutdown"),
                Logger.getLogger("test"));
        assertEquals(List.of("disable", "shutdown"), calls);
    }

    @Test
    void aSuccessfulEnableLeavesTheServerRunning() {
        List<String> calls = new java.util.ArrayList<>();
        GeldarCore.enableOrStop(() -> calls.add("enable"), () -> calls.add("disable"), () -> calls.add("shutdown"), Logger.getLogger("test"));
        assertEquals(List.of("enable"), calls);
    }
}
