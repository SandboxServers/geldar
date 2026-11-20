package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The listeners {@code BlockOwnerSetup.register} installs, built by the same seams with a real {@link ProvenanceGate}.
 * Pins the supplier handed to each listener: a mis-wired supplier (provenance on for every server with
 * {@code blockowner.enabled}, for example) publishes here and fails. A pickup is driven through {@code onPickup} with a
 * real {@link EntityPickupItemEvent}; its item is an {@link ItemStack} subclass, which needs no server registry.
 */
class ProvenanceWiringTest {
    private static final UUID PICKER_ID = new UUID(1L, 2L);
    private static final UUID THROWER_ID = new UUID(3L, 4L);

    /** An ItemStack with a fixed type and amount. The protected no-arg constructor is the one used. */
    private static final class Stack extends ItemStack {
        @Override
        public Material getType() {
            return Material.STONE;
        }

        @Override
        public int getAmount() {
            return 3;
        }
    }

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

    private static World world() {
        return (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                (proxy, method, args) -> method.getName().equals("getName") ? "world" : null);
    }

    private static Block block() {
        World world = world();
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

    /** The picker: named Bob, standing at (1, 2, 3) in the world. */
    private static Player picker() {
        Location at = new Location(world(), 1, 2, 3);
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getName" -> "Bob";
                    case "getUniqueId" -> PICKER_ID;
                    case "getWorld" -> world();
                    case "getLocation" -> at;
                    default -> null;
                });
    }

    /** A dropped stone stack, thrown by someone other than the picker, alive for 20 ticks. */
    private static Item droppedStone() {
        return (Item) Proxy.newProxyInstance(Item.class.getClassLoader(), new Class<?>[] {Item.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getThrower" -> THROWER_ID;
                    case "getItemStack" -> new Stack();
                    case "getTicksLived" -> 20;
                    default -> null;
                });
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

    /** One pickup of a stone stack through the pickup listener built with {@code gate}; returns what the sink received. */
    private static List<String> pickupThrough(ProvenanceGate gate) {
        List<String> sent = new ArrayList<>();
        ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
        PickupProvenanceListener listener = BlockOwnerSetup.pickupListener(sink, gate, () -> 42L, id -> null);
        listener.onPickup(new EntityPickupItemEvent(picker(), droppedStone(), 0));
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
    @DisplayName("a pickup sends nothing when provenance.enabled is false, with blockowner.enabled true")
    void pickupSilentWhenProvenanceOff() {
        assertTrue(pickupThrough(gateReloadedFrom(config(true, false))).isEmpty());
    }

    @Test
    @DisplayName("a pickup publishes its provenance when both blockowner.enabled and provenance.enabled are true")
    void pickupPublishesWhenBothOn() {
        List<String> sent = pickupThrough(gateReloadedFrom(config(true, true)));
        assertEquals(1, sent.size(), "exactly one provenance message: " + sent);
        assertTrue(sent.get(0).startsWith("pickup "), sent.get(0));
        assertTrue(sent.get(0).contains("\"kind\":\"pickup\""), sent.get(0));
        assertTrue(sent.get(0).contains("\"picker\":\"Bob\""), sent.get(0));
        assertTrue(sent.get(0).contains("\"count\":3"), sent.get(0));
    }

    @Test
    @DisplayName("a pickup sends nothing when blockowner.enabled is false, even with provenance.enabled true")
    void pickupSilentWhenBlockOwnerOff() {
        assertTrue(pickupThrough(gateReloadedFrom(config(false, true))).isEmpty());
    }

    @Test
    @DisplayName("a pickup sends nothing before the first reload")
    void pickupSilentBeforeReload() {
        assertTrue(pickupThrough(new ProvenanceGate()).isEmpty());
    }
}
