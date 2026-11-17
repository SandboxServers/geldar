package dev.geldar.ledger.neoforge.state;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.neoforge.world.WorldCollector;
import dev.geldar.ledger.neoforge.world.WorldCounts;
import java.util.List;
import org.junit.jupiter.api.Test;

class WorldCollectorTest {
    @Test
    void gaugesPerDimensionFollowTheRunningCounts() {
        FakeRig r = new FakeRig();
        WorldCounts c = new WorldCounts();
        c.chunk("minecraft:overworld", 1); // spawn chunk loaded before the collector starts
        new WorldCollector(c, () -> List.of("minecraft:overworld", "minecraft:the_nether")).start(r.ctx());
        assertEquals(6, r.gauges.size());
        String ow = "[world, minecraft:overworld]";
        assertEquals(1, r.gauges.get("geldar_world_loaded_chunks" + ow).getAsLong());
        c.chunk("minecraft:overworld", 2);
        c.chunk("minecraft:overworld", -1);
        c.entity("minecraft:overworld", false, 1);
        c.entity("minecraft:overworld", true, 1);
        c.entity("minecraft:overworld", true, -1);
        assertEquals(2, r.gauges.get("geldar_world_loaded_chunks" + ow).getAsLong());
        assertEquals(1, r.gauges.get("geldar_world_entities" + ow).getAsLong());
        assertEquals(0, r.gauges.get("geldar_world_players" + ow).getAsLong());
        c.entity("minecraft:the_nether", true, 1);
        assertEquals(1, r.gauges.get("geldar_world_players[world, minecraft:the_nether]").getAsLong());
    }

    @Test
    void descriptionsSayApproximate() {
        FakeRig r = new FakeRig();
        new WorldCollector(new WorldCounts(), () -> List.of("a")).start(r.ctx());
        for (String n : new String[] {"geldar_world_loaded_chunks", "geldar_world_entities", "geldar_world_players"}) {
            assertTrue(r.descriptions.get(n).contains("approximate"), n);
        }
    }

    @Test
    void neverGoesNegative() {
        WorldCounts c = new WorldCounts();
        c.chunk("a", -1);
        c.entity("a", true, -1);
        assertEquals(0, c.get("a", WorldCounts.CHUNKS));
        assertEquals(0, c.get("a", WorldCounts.PLAYERS));
    }

    @Test
    void dimensionNamesAreBounded() {
        WorldCounts c = new WorldCounts();
        for (int i = 0; i < 40; i++) {
            c.chunk("dim" + i, 1);
        }
        c.chunk("x".repeat(WorldCounts.MAX_NAME + 1), 1);
        c.chunk("", 1);
        c.chunk(null, 1);
        assertEquals(WorldCounts.MAX_WORLDS, c.names().size());
        FakeRig r = new FakeRig();
        new WorldCollector(c, () -> List.of("extra")).start(r.ctx());
        assertEquals(3 * WorldCounts.MAX_WORLDS, r.gauges.size());
    }

    @Test
    void offWhenCollectorOrMasterDisabled() {
        for (String line : new String[] {"collector.world.enabled=false", "enabled=false"}) {
            FakeRig r = new FakeRig(line);
            new WorldCollector(new WorldCounts(), () -> List.of("a")).start(r.ctx());
            assertTrue(r.gauges.isEmpty(), line);
        }
    }

    @Test
    void attributesAreBareKeysAndNoGuardIsUsed() {
        FakeRig r = new FakeRig();
        new WorldCollector(new WorldCounts(), () -> List.of("minecraft:overworld")).start(r.ctx());
        r.gaugeAttrs.forEach(a -> assertTrue(a.startsWith("[world, "), a));
        assertEquals(0, r.begins.get());
        assertEquals(0, r.guardOffMain.get());
    }
}