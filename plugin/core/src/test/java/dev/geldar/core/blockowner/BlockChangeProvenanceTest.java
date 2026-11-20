package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.junit.jupiter.api.Test;

class BlockChangeProvenanceTest {
    /** x differs from z, so an x/z swap in the JSON or in the owner lookup is visible. */
    private static final Pos POS = new Pos("world", 5, 64, 9);
    /** Negative on every axis: chunkOf and the coordinates must hold across zero. */
    private static final Pos NEG = new Pos("world", -3, 70, -20);

    /** A world proxy with the name the listener reads. */
    private static World world(String name) {
        return (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                (proxy, method, args) -> method.getName().equals("getName") ? name : null);
    }

    /** A block proxy at {@code pos} of {@code type}. */
    private static Block block(Pos pos, Material type) {
        World w = world(pos.world());
        return (Block) Proxy.newProxyInstance(Block.class.getClassLoader(), new Class<?>[] {Block.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getWorld" -> w;
                    case "getX" -> pos.x();
                    case "getY" -> pos.y();
                    case "getZ" -> pos.z();
                    case "getType" -> type;
                    default -> null;
                });
    }

    /** A player proxy with the name the listener reads. */
    private static Player player(String name) {
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                (proxy, method, args) -> method.getName().equals("getName") ? name : null);
    }

    /** A cache with a fixed clock; the chunk of {@code pos} holds {@code owner} at {@code pos}, or nothing when null. */
    private static OwnerCache cacheWithOwner(Pos pos, String owner) {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        if (owner != null) {
            cache.storeBase(OwnerCache.chunkOf(pos),
                    new Owners(List.of(new OwnedBlock(pos.x(), pos.y(), pos.z(), owner, "stone")), false));
        }
        return cache;
    }

    private static OwnerCache cacheWithOwner(String owner) {
        return cacheWithOwner(POS, owner);
    }

    private static final class Harness {
        final List<String> provenance = new ArrayList<>();
        final List<String> changed = new ArrayList<>();
        final BlockOwnerPublisher publisher = new BlockOwnerPublisher(changed::add, Logger.getAnonymousLogger());
    }

    private static BlockChangeListener listener(OwnerCache cache, Harness h, boolean flag) {
        ProvenanceSink sink = (tail, json) -> h.provenance.add(tail + " " + json);
        return new BlockChangeListener(cache, h.publisher, () -> true, sink, () -> flag, () -> 42L);
    }

    private static JsonObject onlyProvenance(Harness h) {
        assertEquals(1, h.provenance.size(), "exactly one provenance message: " + h.provenance);
        String line = h.provenance.get(0);
        assertTrue(line.startsWith("break "), line);
        return JsonParser.parseString(line.substring("break ".length())).getAsJsonObject();
    }

    @Test
    void anOwnedBlockBrokenByAnotherPlayerSendsThePriorOwner() {
        Harness h = new Harness();
        BlockChangeListener l = listener(cacheWithOwner("Bob"), h, true);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));

        JsonObject j = onlyProvenance(h);
        assertEquals("break", j.get("kind").getAsString());
        assertEquals("world", j.get("world").getAsString());
        assertEquals(5, j.get("x").getAsInt());
        assertEquals(64, j.get("y").getAsInt());
        assertEquals(9, j.get("z").getAsInt());
        assertEquals("Alice", j.get("actor").getAsString());
        assertEquals("Bob", j.get("prior_owner").getAsString());
        assertEquals("stone", j.get("block").getAsString());
        assertEquals(42L, j.get("tick").getAsLong());
    }

    @Test
    void negativeCoordinatesAreReportedAndTheOwnerIsFound() {
        Harness h = new Harness();
        BlockChangeListener l = listener(cacheWithOwner(NEG, "Bob"), h, true);

        l.onBreak(new BlockBreakEvent(block(NEG, Material.STONE), player("Alice")));

        JsonObject j = onlyProvenance(h);
        assertEquals(-3, j.get("x").getAsInt());
        assertEquals(70, j.get("y").getAsInt());
        assertEquals(-20, j.get("z").getAsInt());
        assertEquals("Bob", j.get("prior_owner").getAsString());
    }

    @Test
    void anUnownedBlockSendsPriorOwnerNull() {
        Harness h = new Harness();
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        cache.storeBase(OwnerCache.chunkOf(POS), new Owners(List.of(), false));
        BlockChangeListener l = listener(cache, h, true);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));

        assertTrue(onlyProvenance(h).get("prior_owner").isJsonNull());
    }

    @Test
    void aCacheMissSendsPriorOwnerNull() {
        Harness h = new Harness();
        BlockChangeListener l = listener(cacheWithOwner(null), h, true);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));

        assertTrue(onlyProvenance(h).get("prior_owner").isJsonNull());
    }

    @Test
    void aRecentPlacementInThePluginIsThePriorOwner() {
        Harness h = new Harness();
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        cache.storeBase(OwnerCache.chunkOf(POS), new Owners(List.of(), false));
        cache.recordChange(POS, "Bob");
        BlockChangeListener l = listener(cache, h, true);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));

        assertEquals("Bob", onlyProvenance(h).get("prior_owner").getAsString());
    }

    @Test
    void aFailingProvenanceSendStillRecordsTheBreak() {
        Harness h = new Harness();
        OwnerCache cache = cacheWithOwner("Bob");
        ProvenanceSink failing = (tail, json) -> {
            throw new IllegalStateException("nats reconnecting, buffer full");
        };
        BlockChangeListener l = new BlockChangeListener(cache, h.publisher, () -> true, failing, () -> true, () -> 42L);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        h.publisher.flush();

        assertEquals(1, h.changed.size(), "the break is still published: " + h.changed);
        assertNull(BlockChangeListener.priorOwner(cache, POS), "the cache no longer holds the broken owner");
    }

    @Test
    void aDisabledPluginSendsNothingEvenWithTheFlagOn() {
        Harness h = new Harness();
        ProvenanceSink sink = (tail, json) -> h.provenance.add(tail + " " + json);
        BlockChangeListener l = new BlockChangeListener(cacheWithOwner("Bob"), h.publisher, () -> false, sink,
                () -> true, () -> 42L);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        h.publisher.flush();

        assertTrue(h.provenance.isEmpty(), "a disabled plugin must send nothing: " + h.provenance);
        assertTrue(h.changed.isEmpty(), "a disabled plugin must publish no change");
    }

    @Test
    void flagOffOrNullSinkSendsNothingAndTheChangedPublishIsUnchanged() {
        Harness off = new Harness();
        listener(cacheWithOwner("Bob"), off, false)
                .onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        off.publisher.flush();

        Harness none = new Harness();
        new BlockChangeListener(cacheWithOwner("Bob"), none.publisher, () -> true, null, () -> true, () -> 42L)
                .onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        none.publisher.flush();

        Harness threeArg = new Harness();
        new BlockChangeListener(cacheWithOwner("Bob"), threeArg.publisher, () -> true)
                .onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        threeArg.publisher.flush();

        assertTrue(off.provenance.isEmpty(), "flag off must send nothing: " + off.provenance);
        assertTrue(none.provenance.isEmpty(), "null sink sends nothing");
        assertFalse(off.changed.isEmpty(), "the change is still published");
        assertEquals(threeArg.changed, off.changed, "the changed JSON is byte-identical to before");
        assertEquals(threeArg.changed, none.changed, "the changed JSON is byte-identical to before");
    }

    @Test
    void placementSendsNoProvenance() {
        Harness h = new Harness();
        BlockChangeListener l = listener(cacheWithOwner("Bob"), h, true);

        l.onPlace(new BlockPlaceEvent(block(POS, Material.STONE), null, null, null, player("Alice"), true, null));

        assertTrue(h.provenance.isEmpty(), "placement must not send provenance: " + h.provenance);
    }

    @Test
    void theThreeArgumentConstructorStillRecordsTheChange() {
        Harness h = new Harness();
        BlockChangeListener l = new BlockChangeListener(cacheWithOwner("Bob"), h.publisher, () -> true);

        l.onBreak(new BlockBreakEvent(block(POS, Material.STONE), player("Alice")));
        h.publisher.flush();

        assertEquals(1, h.changed.size(), "the break is still published: " + h.changed);
    }
}
