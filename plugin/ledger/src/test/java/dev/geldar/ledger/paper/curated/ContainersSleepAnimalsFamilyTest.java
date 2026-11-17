package dev.geldar.ledger.paper.curated;

import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.block;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.fake;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.player;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.world;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Cow;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Wolf;
import org.bukkit.event.Event;
import org.bukkit.event.entity.EntityBreedEvent;
import org.bukkit.event.entity.EntityTameEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerBedEnterEvent.BedEnterResult;
import io.papermc.paper.block.bed.BedEnterAction;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

class ContainersSleepAnimalsFamilyTest {
    static final BedEnterAction ACT = fake(BedEnterAction.class, Map.of());

    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
    final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
    final Map<Class<?>, Boolean> ignoreCancelled = new LinkedHashMap<>();
    final List<Class<?>> order = new ArrayList<>();
    final CuratedRegistry registry = new CuratedRegistry(
            ledger.events(),
            ledger.guard("curated"),
            host,
            new CuratedRegistry.Binder() {
                @Override
                public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignore) {
                    executors.put(type, executor);
                    ignoreCancelled.put(type, ignore);
                }

                @Override
                public void unbindAll() {
                    executors.clear();
                }
            });

    ContainersSleepAnimalsFamilyTest() {
        new ContainersSleepAnimalsFamily().register(registry);
    }

    void fire(Class<?> type, Event e) throws Exception {
        executors.get(type).execute(new org.bukkit.event.Listener() {}, e);
    }

    @Test
    void registersTheTenEventsWithNoRejectedKeys() {
        assertEquals(10, registry.registeredCount());
        assertTrue(ledger.rejectedEventKeys().isEmpty());
        assertEquals(Boolean.FALSE, ignoreCancelled.get(PlayerBedEnterEvent.class));
        assertEquals(
                List.of("geldar.x", "geldar.y", "geldar.z", "geldar.life_id", "geldar.result", "geldar.world"),
                ledger.eventFields("geldar.sleep.enter"));
    }

    @Test
    void bedEnterRecordsEveryResultNameWhetherOrNotCancelled() throws Exception {
        for (BedEnterResult result : BedEnterResult.values()) {
            PlayerBedEnterEvent e = new PlayerBedEnterEvent(player("ag_mira_01"), block(4, 63, -9, Material.RED_BED), result, ACT);
            e.setCancelled(result != BedEnterResult.OK);
            fire(PlayerBedEnterEvent.class, e);
        }
        List<RecordingLedger.EventRecord> got = ledger.events("geldar.sleep.enter");
        assertEquals(BedEnterResult.values().length, got.size());
        assertEquals("NOT_POSSIBLE_NOW", got.get(BedEnterResult.NOT_POSSIBLE_NOW.ordinal()).s2());
        assertEquals(4, got.get(0).a());
        assertEquals(63, got.get(0).b());
        assertEquals(-9, got.get(0).c());
        assertEquals("ag_mira_01", got.get(0).s1());
        assertEquals("world_nether", got.get(0).s3());
        assertEquals(0, registry.errorCount());
    }

    // InventoryType and InventoryView cannot be initialised without a server (their registries bootstrap it), so the
    // open/close event itself is compile-only here (scratch row V4); the position logic they share is checked directly.
    @Test
    void containerWithNoLocationIsZerosAndTheTypeNameAndThePlayersWorld() {
        CuratedRegistry.FieldSink s = new CuratedRegistry.FieldSink();
        s.l1 = 9; // stale values from a previous event must not survive
        ContainersSleepAnimalsFamily.container(s, player("ag_mira_01"), null, "CRAFTING");
        assertEquals(0, s.l1);
        assertEquals(0, s.l2);
        assertEquals(0, s.l3);
        assertEquals("CRAFTING", s.s2);
        assertEquals("world_nether", s.s3);
        assertEquals("ag_mira_01", s.s1);
    }

    @Test
    void containerLocationIsTheRoundedBlockOnEverySign() {
        CuratedRegistry.FieldSink s = new CuratedRegistry.FieldSink();
        ContainersSleepAnimalsFamily.container(s, player("ag_mira_01"), new Location(world(), -3.4, 70.9, 12.0), "CHEST");
        assertEquals(-4, s.l1);
        assertEquals(70, s.l2);
        assertEquals(12, s.l3);
        ContainersSleepAnimalsFamily.container(s, player("Notch"), new Location(world(), 3.4, -0.1, -12.5), "BARREL");
        assertEquals(3, s.l1);
        assertEquals(-1, s.l2);
        assertEquals(-13, s.l3);
        assertNull(s.s1); // a human name is not copied
    }
    @Test
    void aNonPlayerBreederRecordsNothingAndAPlayerBreederDoes() throws Exception {
        LivingEntity child = fake(LivingEntity.class, Map.of("getType", EntityType.COW));
        LivingEntity parent = fake(Cow.class, Map.of());
        LivingEntity npcBreeder = fake(Cow.class, Map.of()); // not a Player; its getCustomName would throw
        fire(EntityBreedEvent.class, new EntityBreedEvent(child, parent, parent, npcBreeder, null, 1));
        fire(EntityBreedEvent.class, new EntityBreedEvent(child, parent, parent, null, null, 1));
        assertEquals(0, ledger.events("geldar.animal.breed").size());
        fire(EntityBreedEvent.class, new EntityBreedEvent(child, parent, parent, player("ag_mira_01"), null, 1));
        RecordingLedger.EventRecord r = ledger.events("geldar.animal.breed").get(0);
        assertEquals("COW", r.s2());
        assertEquals("ag_mira_01", r.s1());
        assertEquals(10, r.a());
        assertEquals(-1, r.c());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void aNonPlayerOwnerTameRecordsNothing() throws Exception {
        Wolf wolf = fake(Wolf.class, Map.of("getType", EntityType.WOLF));
        org.bukkit.entity.AnimalTamer npc = fake(org.bukkit.entity.AnimalTamer.class, Map.of());
        fire(EntityTameEvent.class, new EntityTameEvent(wolf, npc));
        assertEquals(0, ledger.events("geldar.animal.tame").size());
        fire(EntityTameEvent.class, new EntityTameEvent(wolf, player("ag_mira_01")));
        assertEquals("WOLF", ledger.events("geldar.animal.tame").get(0).s2());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void aHumanNameIsNeverRecorded() throws Exception {
        PlayerBedEnterEvent e = new PlayerBedEnterEvent(player("Notch"), block(1, 2, 3, Material.RED_BED), BedEnterResult.OK, ACT);
        fire(PlayerBedEnterEvent.class, e);
        assertNull(ledger.events("geldar.sleep.enter").get(0).s1());
        assertFalse(String.valueOf(ledger.allEvents()).contains("Notch"));
    }

    @Test
    void professionNamesAreUpperCasedAndCapped() {
        assertEquals("FARMER", ContainersSleepAnimalsFamily.bounded("farmer"));
        assertEquals(48, ContainersSleepAnimalsFamily.bounded("x".repeat(500)).length());
        assertNull(ContainersSleepAnimalsFamily.bounded(null));
    }
}
