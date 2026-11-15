package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** One assertion per row of decision 0199, step 4. Changing a row fails exactly its test. */
class AbsorptionTableTest {
    private static double of(String id, boolean open) {
        return AbsorptionTable.of(new BlockProbe(id, true, open));
    }

    @Test
    void airAbsorbsNothing() {
        assertEquals(0.0, AbsorptionTable.of(new BlockProbe("minecraft:air", false, false)));
    }

    @Test
    void glassAbsorbsHalf() {
        assertEquals(0.5, of("minecraft:glass", false));
    }

    @Test
    void glassPaneAbsorbsHalf() {
        assertEquals(0.5, of("minecraft:glass_pane", false));
    }

    @Test
    void ironBarsAbsorbHalf() {
        assertEquals(0.5, of("minecraft:iron_bars", false));
    }

    @Test
    void oakFenceAbsorbsOne() {
        assertEquals(1.0, of("minecraft:oak_fence", false));
    }

    @Test
    void closedFenceGateAbsorbsOne() {
        assertEquals(1.0, of("minecraft:oak_fence_gate", false));
    }

    @Test
    void openFenceGateAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:oak_fence_gate", true));
    }

    @Test
    void cobblestoneWallAbsorbsOne() {
        assertEquals(1.0, of("minecraft:cobblestone_wall", false));
    }

    @Test
    void woodPlanksAbsorbOne() {
        assertEquals(1.0, of("minecraft:oak_planks", false));
    }

    @Test
    void logsAbsorbOne() {
        assertEquals(1.0, of("minecraft:oak_log", false));
    }

    @Test
    void leavesAbsorbOne() {
        assertEquals(1.0, of("minecraft:oak_leaves", false));
    }

    @Test
    void closedWoodenDoorAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:oak_door", false));
    }

    @Test
    void openWoodenDoorAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:oak_door", true));
    }

    @Test
    void closedTrapdoorAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:oak_trapdoor", false));
    }

    @Test
    void openTrapdoorAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:oak_trapdoor", true));
    }

    @Test
    void stoneAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:stone", false));
    }

    @Test
    void dirtAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:dirt", false));
    }

    @Test
    void gravelAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:gravel", false));
    }

    @Test
    void oreAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:iron_ore", false));
    }

    @Test
    void bricksAbsorbTwo() {
        assertEquals(2.0, of("minecraft:bricks", false));
    }

    @Test
    void whiteWoolAbsorbsThree() {
        assertEquals(3.0, of("minecraft:white_wool", false));
    }

    @Test
    void otherWoolColourAbsorbsThree() {
        assertEquals(3.0, of("minecraft:red_wool", false));
    }

    @Test
    void waterAbsorbsOnePerBlock() {
        assertEquals(1.0, AbsorptionTable.of(new BlockProbe("minecraft:water", false, false)));
    }

    @Test
    void anUnknownSolidBlockAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:some_future_block", false));
    }
}
