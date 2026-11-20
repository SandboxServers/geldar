package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.BlockOwnerSetup;
import dev.geldar.core.blockowner.ProvenanceSink;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
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

    private static final String LIFE = "ag_wren_02";
    private static final String PLAYER = "11111111-2222-3333-4444-555555555555";
    private static final String MOB = "0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b";

    @Test
    void combatFactIsSilentWhileTheProvenanceSwitchIsOffAndPublishesOnceItIsOn() {
        AtomicBoolean on = new AtomicBoolean(false);
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        EventExporter ex = new EventExporter(
                mem, "phase0", () -> 100, () -> Instant.parse("2026-11-09T00:00:00Z"), Logger.getLogger("test"));
        ProvenanceSink sink = (tail, json) -> { };
        CombatFactListener listener = new CombatFactListener(ex, sink, on::get, () -> 10L);

        listener.playerHurt(LIFE, PLAYER, MOB, "zombie", 10);
        listener.mobDied(MOB, "zombie", LIFE, PLAYER, 20);
        assertTrue(mem.events().isEmpty(), "no fact while the switch is off");

        on.set(true);
        listener.playerHurt(LIFE, PLAYER, MOB, "zombie", 30);
        listener.mobDied(MOB, "zombie", LIFE, PLAYER, 40);
        assertEquals(1, mem.events().size(), "one fact once the switch is on");
    }

    @Test
    void combatListenerIsBuiltOnceAndRegisteredOnceWithTheProvenanceSwitch() throws IOException {
        String core = Files.readString(Path.of("src/main/java/dev/geldar/core/GeldarCore.java"));
        String owner = Files.readString(Path.of("src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java"));
        assertEquals(1, count(owner, "new CombatFactListener("), "one construction site");
        assertEquals(1, count(core, "owners.combatFacts(exporter,"), "one seam call in onEnable");
        assertEquals(0, count(core, "new CombatFactListener("), "GeldarCore never builds the listener itself");
        assertEquals(1, count(core, "registerEvents(combat, this)"), "one event registration");
        assertEquals(1, count(core, "runTaskTimer(this, combat::tick, 1L, 1L)"), "one tick per server tick");
    }

    private static int count(String source, String needle) {
        return (source.length() - source.replace(needle, "").length()) / needle.length();
    }
}
