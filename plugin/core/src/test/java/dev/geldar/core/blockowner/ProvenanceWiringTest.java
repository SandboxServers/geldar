package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.CombatFactListener;
import dev.geldar.core.EventExporter;
import dev.geldar.core.InMemoryEventPublisher;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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

    private static final Pos CHEST = new Pos("world", 10, 64, -3);

    /** One full-stack take from a chest the owner holds, through the take listener built with {@code gate}. */
    private static List<String> takeThrough(ProvenanceGate gate) {
        List<String> sent = new ArrayList<>();
        ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        cache.storeBase(OwnerCache.chunkOf(CHEST), new Owners(
                List.of(new OwnedBlock(CHEST.x(), CHEST.y(), CHEST.z(), "ag_kestrel_01", "chest")), false));
        ContainerTakeListener listener = BlockOwnerSetup.containerTakeListener(sink, cache,
                gate, () -> 42L, Runnable::run);
        listener.clicked("ag_wren_02", CHEST, Map.of("diamond", 64), Map::of);
        return sent;
    }

    @Test
    @DisplayName("a take sends nothing when provenance.enabled is false, with blockowner.enabled true")
    void takeSilentWhenProvenanceOff() {
        assertTrue(takeThrough(gateReloadedFrom(config(true, false))).isEmpty());
    }

    @Test
    @DisplayName("a take sends one take message when both blockowner.enabled and provenance.enabled are true")
    void takeSendsWhenBothOn() {
        List<String> sent = takeThrough(gateReloadedFrom(config(true, true)));
        assertEquals(1, sent.size(), "exactly one take message: " + sent);
        assertTrue(sent.get(0).startsWith("take "), sent.get(0));
    }

    @Test
    @DisplayName("a take sends nothing when blockowner.enabled is false, even with provenance.enabled true")
    void takeSilentWhenBlockOwnerOff() {
        assertTrue(takeThrough(gateReloadedFrom(config(false, true))).isEmpty());
    }

    private static final String LIFE = "ag_wren_02";
    private static final String PLAYER = "11111111-2222-3333-4444-555555555555";
    private static final String MOB = "0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b";

    /**
     * A zombie hurts the player, the player hits it (the first hit sends {@code engaged}), then it dies by the player's
     * hand, through the combat listener that {@code BlockOwnerSetup.combatFactListener} builds with {@code gate}. The
     * publish paths are package-private in {@code dev.geldar.core}, so they are called by reflection; the public
     * handlers take Bukkit entity events.
     */
    private static void combatThrough(ProvenanceGate gate, List<String> sent, InMemoryEventPublisher mem)
            throws ReflectiveOperationException {
        EventExporter exporter = new EventExporter(
                mem, "phase0", () -> 100, () -> Instant.parse("2026-11-09T00:00:00Z"), Logger.getLogger("test"));
        CombatFactListener listener = BlockOwnerSetup.combatFactListener(
                exporter, (tail, json) -> sent.add(tail + " " + json), gate, () -> 10L);
        Method hurt = CombatFactListener.class.getDeclaredMethod(
                "playerHurt", String.class, String.class, String.class, String.class, long.class);
        Method hit = CombatFactListener.class.getDeclaredMethod(
                "playerHit", String.class, String.class, String.class, String.class, String.class, long.class);
        Method died = CombatFactListener.class.getDeclaredMethod(
                "mobDied", String.class, String.class, String.class, String.class, long.class);
        hurt.setAccessible(true);
        hit.setAccessible(true);
        died.setAccessible(true);
        hurt.invoke(listener, LIFE, PLAYER, MOB, "zombie", 30L);
        hit.invoke(listener, "world", LIFE, PLAYER, MOB, "zombie", 31L);
        died.invoke(listener, MOB, "zombie", LIFE, PLAYER, 40L);
    }

    @Test
    @DisplayName("a combat fact sends nothing before the first reload")
    void combatSilentBeforeReload() throws ReflectiveOperationException {
        List<String> sent = new ArrayList<>();
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        combatThrough(new ProvenanceGate(), sent, mem);
        assertTrue(sent.isEmpty(), "no sink message: " + sent);
        assertTrue(mem.events().isEmpty(), "no combat_fact event");
    }

    @Test
    @DisplayName("a combat fact is silent when blockowner.enabled is true and provenance.enabled is false")
    void combatSilentWhenProvenanceOff() throws ReflectiveOperationException {
        List<String> sent = new ArrayList<>();
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        combatThrough(gateReloadedFrom(config(true, false)), sent, mem);
        assertTrue(sent.isEmpty(), "no sink message: " + sent);
        assertTrue(mem.events().isEmpty(), "no combat_fact event");
    }

    @Test
    @DisplayName("a combat fact publishes when both blockowner.enabled and provenance.enabled are true")
    void combatPublishesWhenBothOn() throws ReflectiveOperationException {
        List<String> sent = new ArrayList<>();
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        combatThrough(gateReloadedFrom(config(true, true)), sent, mem);
        assertEquals(1, sent.size(), "exactly one provenance message: " + sent);
        assertTrue(sent.get(0).startsWith("combat "), sent.get(0));
        assertEquals(1, mem.events().size(), "exactly one combat_fact event");
    }

    @Test
    @DisplayName("a combat fact is silent when blockowner.enabled is false and provenance.enabled is true")
    void combatSilentWhenBlockOwnerOff() throws ReflectiveOperationException {
        List<String> sent = new ArrayList<>();
        InMemoryEventPublisher mem = new InMemoryEventPublisher();
        combatThrough(gateReloadedFrom(config(false, true)), sent, mem);
        assertTrue(sent.isEmpty(), "no sink message: " + sent);
        assertTrue(mem.events().isEmpty(), "no combat_fact event");
    }
}
