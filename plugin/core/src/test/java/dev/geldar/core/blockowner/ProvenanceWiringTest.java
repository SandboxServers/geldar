package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The listeners {@code BlockOwnerSetup.register} installs, built by the same seams with a real {@link ProvenanceGate}.
 * Pins the supplier handed to each listener: a mis-wired supplier (provenance on for every server with
 * {@code blockowner.enabled}, for example) publishes here and fails.
 */
class ProvenanceWiringTest {

    private static YamlConfiguration config(boolean blockOwnerEnabled, boolean provenance) {
        YamlConfiguration config = new YamlConfiguration();
        config.set("blockowner.enabled", blockOwnerEnabled);
        config.set("provenance.enabled", provenance);
        return config;
    }

    private static ProvenanceGate gateReloadedFrom(YamlConfiguration config) {
        ProvenanceGate gate = new ProvenanceGate();
        gate.reload(config);
        return gate;
    }

    private static Block block() {
        World world = (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                (proxy, method, args) -> method.getName().equals("getName") ? "world" : null);
        return (Block) Proxy.newProxyInstance(Block.class.getClassLoader(), new Class<?>[] {Block.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getWorld" -> world;
                    case "getX" -> 5;
                    case "getY" -> 64;
                    case "getZ" -> 9;
                    case "getType" -> Material.STONE;
                    default -> null;
                });
    }

    private static Player player(String name) {
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                (proxy, method, args) -> method.getName().equals("getName") ? name : null);
    }

    /** One break of a block through the break listener built with {@code gate}; returns what the sink received. */
    private static List<String> breakThrough(ProvenanceGate gate, boolean blockOwnerEnabled) {
        List<String> sent = new ArrayList<>();
        ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(new ArrayList<String>()::add,
                Logger.getAnonymousLogger());
        BlockChangeListener listener = BlockOwnerSetup.breakListener(new OwnerCache(() -> 1_000L), publisher,
                () -> blockOwnerEnabled, sink, gate, () -> 42L);
        listener.onBreak(new BlockBreakEvent(block(), player("Alice")));
        return sent;
    }

    @Test
    @DisplayName("a break sends nothing when provenance.enabled is false, with blockowner.enabled true")
    void breakSilentWhenProvenanceOff() {
        assertTrue(breakThrough(gateReloadedFrom(config(true, false)), true).isEmpty());
    }

    @Test
    @DisplayName("a break sends its provenance when both blockowner.enabled and provenance.enabled are true")
    void breakSendsWhenBothOn() {
        List<String> sent = breakThrough(gateReloadedFrom(config(true, true)), true);
        assertEquals(1, sent.size(), "exactly one provenance message: " + sent);
        assertTrue(sent.get(0).startsWith("break "), sent.get(0));
    }

    @Test
    @DisplayName("a break sends nothing when blockowner.enabled is false, even with provenance.enabled true")
    void breakSilentWhenBlockOwnerOff() {
        assertTrue(breakThrough(gateReloadedFrom(config(false, true)), false).isEmpty());
    }

    @Test
    @DisplayName("a break sends nothing before the first reload")
    void breakSilentBeforeReload() {
        assertTrue(breakThrough(new ProvenanceGate(), true).isEmpty());
    }

    @Test
    @DisplayName("a pickup reads no event and sends nothing when provenance.enabled is false")
    void pickupSilentWhenProvenanceOff() {
        List<String> sent = new ArrayList<>();
        PickupProvenanceListener listener = BlockOwnerSetup.pickupListener((tail, json) -> sent.add(tail),
                gateReloadedFrom(config(true, false)), () -> 42L, id -> null);
        // The gate check comes before any read of the event, so a null event is never touched while the gate is off.
        // A mis-wired gate that is on reads the null event and fails here with a NullPointerException.
        assertDoesNotThrow(() -> listener.onPickup(null));
        assertTrue(sent.isEmpty(), "no pickup message: " + sent);
    }
}
