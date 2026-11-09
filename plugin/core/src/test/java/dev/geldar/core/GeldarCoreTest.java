package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.event.Listener;
import org.junit.jupiter.api.Test;

/** JavaPlugin cannot be built without a server, so the wiring that onEnable registers is tested directly. */
class GeldarCoreTest {
    @Test
    void enableRegistersTheExporterAndTheCommandBlockButNotTheRecipeGrantByDefault() {
        EventExporter exporter = exporter();
        List<Listener> listeners = GeldarCore.listeners(exporter, Logger.getLogger("test"), false);

        assertEquals(2, listeners.size());
        assertTrue(listeners.contains(exporter));
        assertTrue(listeners.stream().anyMatch(l -> l instanceof CommandBlockListener));
        assertTrue(listeners.stream().noneMatch(l -> l instanceof RecipeGrantListener));
    }

    @Test
    void theRecipeGrantIsRegisteredWhenTheFlagIsSet() {
        List<Listener> listeners = GeldarCore.listeners(exporter(), Logger.getLogger("test"), true);

        assertEquals(3, listeners.size());
        assertTrue(listeners.stream().anyMatch(l -> l instanceof RecipeGrantListener));
    }

    private static EventExporter exporter() {
        return new EventExporter(
                new InMemoryEventPublisher(), "phase0", () -> 0, Instant::now, Logger.getLogger("test"));
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
