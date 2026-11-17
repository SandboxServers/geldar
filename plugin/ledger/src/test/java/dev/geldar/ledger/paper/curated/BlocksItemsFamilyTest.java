package dev.geldar.ledger.paper.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import java.lang.reflect.Proxy;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.player.PlayerHarvestBlockEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

class BlocksItemsFamilyTest {
    /** A proxy that answers only what the map names; anything else (an address getter, a setter) throws. */
    @SuppressWarnings("unchecked")
    static <T> T fake(Class<T> type, Map<String, Object> answers) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (p, m, a) -> {
            if (m.getName().equals("hashCode")) {
                return System.identityHashCode(p);
            }
            if (m.getName().equals("equals")) {
                return p == a[0];
            }
            if (m.getName().equals("toString")) {
                return "fake";
            }
            if (!answers.containsKey(m.getName())) {
                throw new UnsupportedOperationException(m.getName());
            }
            return answers.get(m.getName());
        });
    }

    static World world() {
        return fake(World.class, Map.of("getName", "world_nether"));
    }

    static Block block(int x, int y, int z, Material type) {
        return fake(Block.class, Map.of("getX", x, "getY", y, "getZ", z, "getType", type, "getWorld", world()));
    }

    static Player player(String name) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("getName", name);
        m.put("getX", 10.7);
        m.put("getY", 64.0);
        m.put("getZ", -0.5);
        m.put("getWorld", world());
        return fake(Player.class, m); // getAddress, getUniqueId, displayName... all throw
    }

    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
    final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
    final List<Boolean> ignoreCancelled = new java.util.ArrayList<>();
    final CuratedRegistry registry = new CuratedRegistry(
            ledger.events(),
            ledger.guard("curated"),
            host,
            new CuratedRegistry.Binder() {
                @Override
                public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignore) {
                    executors.put(type, executor);
                    ignoreCancelled.add(ignore);
                }

                @Override
                public void unbindAll() {
                    executors.clear();
                }
            });

    BlocksItemsFamilyTest() {
        new BlocksItemsFamily().register(registry);
    }

    void fire(Class<?> type, Event e) throws Exception {
        executors.get(type).execute(new org.bukkit.event.Listener() {}, e);
    }

    @Test
    void registersTheThirteenEventsWithNoRejectedKeys() {
        assertEquals(13, registry.registeredCount());
        assertEquals(13, executors.size());
        assertTrue(ignoreCancelled.stream().allMatch(b -> b));
        assertEquals(
                List.of("geldar.x", "geldar.y", "geldar.z", "geldar.life_id", "geldar.block", "geldar.world"),
                ledger.eventFields("geldar.block.break"));
        assertEquals(
                List.of("geldar.x", "geldar.y", "geldar.z", "geldar.life_id", "geldar.item", "geldar.world"),
                ledger.eventFields("geldar.item.consume"));
        assertTrue(ledger.rejectedEventKeys().isEmpty());
    }

    @Test
    void blockBreakRecordsPositionLifeIdMaterialAndWorld() throws Exception {
        fire(BlockBreakEvent.class, new BlockBreakEvent(block(3, -60, 8, Material.DIAMOND_ORE), player("ag_mira_01")));
        List<RecordingLedger.EventRecord> got = ledger.events("geldar.block.break");
        assertEquals(1, got.size());
        RecordingLedger.EventRecord r = got.get(0);
        assertEquals(3, r.a());
        assertEquals(-60, r.b());
        assertEquals(8, r.c());
        assertEquals("ag_mira_01", r.s1());
        assertEquals("DIAMOND_ORE", r.s2());
        assertEquals("world_nether", r.s3());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void aHumanPlayerNameNeverReachesTheRecord() throws Exception {
        fire(BlockBreakEvent.class, new BlockBreakEvent(block(1, 2, 3, Material.STONE), player("Notch")));
        RecordingLedger.EventRecord r = ledger.events("geldar.block.break").get(0);
        assertNull(r.s1());
        assertEquals(0, registry.errorCount());
        for (RecordingLedger.EventRecord e : ledger.allEvents()) {
            assertTrue(!String.valueOf(e).contains("Notch"));
        }
    }

    @Test
    void placeAndMultiPlaceAreEachRecordedOnce() throws Exception {
        Block placed = block(5, 6, 7, Material.OAK_PLANKS);
        Player p = player("ag_mira_01");
        BlockPlaceEvent single = new BlockPlaceEvent(placed, null, placed, null, p, true, null);
        BlockMultiPlaceEvent multi = new BlockMultiPlaceEvent(List.of(fake(BlockState.class, Map.of("getBlock", placed))), placed, null, p, true);
        // Both classes share one handler list, so both executors see both events.
        fire(BlockPlaceEvent.class, single);
        fire(BlockMultiPlaceEvent.class, single);
        fire(BlockPlaceEvent.class, multi);
        fire(BlockMultiPlaceEvent.class, multi);
        assertEquals(1, ledger.events("geldar.block.place").size());
        assertEquals(1, ledger.events("geldar.block.multi_place").size());
        assertEquals("OAK_PLANKS", ledger.events("geldar.block.place").get(0).s2());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void anEntityPositionIsRoundedDownOnEveryAxisAndSign() {
        // ItemStack cannot be loaded without a server, so the item events are covered by scratch rows V2 and V3;
        // the entity position path they share is checked here.
        CuratedRegistry.FieldSink s = new CuratedRegistry.FieldSink();
        s.at(10.7, 64.0, -0.5);
        assertEquals(10, s.l1);
        assertEquals(64, s.l2);
        assertEquals(-1, s.l3); // floor, not truncation toward zero
        s.at(-10.7, -0.0001, 3.99);
        assertEquals(-11, s.l1);
        assertEquals(-1, s.l2);
        assertEquals(3, s.l3);
    }

    @Test
    void harvestRecordsTheBlockAndTheMaterial() throws Exception {
        fire(
                PlayerHarvestBlockEvent.class,
                new PlayerHarvestBlockEvent(player("ag_mira_01"), block(-4, 70, 9, Material.SWEET_BERRY_BUSH), EquipmentSlot.HAND, List.of()));
        RecordingLedger.EventRecord r = ledger.events("geldar.block.harvest").get(0);
        assertEquals(-4, r.a());
        assertEquals(70, r.b());
        assertEquals(9, r.c());
        assertEquals("ag_mira_01", r.s1());
        assertEquals("SWEET_BERRY_BUSH", r.s2());
        assertEquals("world_nether", r.s3());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void aNonPlayerPickupRecordsNothing() throws Exception {
        Cow cow = fake(Cow.class, Map.of());
        Item item = fake(Item.class, Map.of());
        fire(EntityPickupItemEvent.class, new EntityPickupItemEvent(cow, item, 0));
        assertEquals(0, ledger.events("geldar.item.pickup").size());
        assertEquals(0, registry.errorCount());
    }
    /** A break event whose every setter throws: the extractor must not call any. */
    static final class StrictBreak extends BlockBreakEvent {
        StrictBreak(Block b, Player p) {
            super(b, p);
        }

        @Override
        public void setCancelled(boolean cancel) {
            throw new AssertionError("setCancelled");
        }

        @Override
        public void setDropItems(boolean dropItems) {
            throw new AssertionError("setDropItems");
        }

        @Override
        public void setExpToDrop(int exp) {
            throw new AssertionError("setExpToDrop");
        }
    }

    @Test
    void theExtractorsNeverCallASetter() throws Exception {
        StrictBreak e = new StrictBreak(block(1, 2, 3, Material.STONE), player("ag_mira_01"));
        fire(BlockBreakEvent.class, e);
        assertEquals(1, ledger.events("geldar.block.break").size());
        assertEquals(0, registry.errorCount());
        assertTrue(!e.isCancelled());
    }

    @Test
    void stopUnregistersEverything() {
        registry.unbindAll();
        assertTrue(executors.isEmpty());
        assertEquals(0, registry.registeredCount());
    }
}
