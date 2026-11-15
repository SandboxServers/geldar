package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** One assertion per row of decision 0199, step 4. Changing a row fails exactly its test. */
class AbsorptionTableTest {
    /** A solid block with this id in the given open state. */
    private static double of(String id, boolean open) {
        return AbsorptionTable.of(new BlockProbe(id, true, open));
    }

    /** A non-solid block with this id, closed. */
    private static double ofNonSolid(String id) {
        return AbsorptionTable.of(new BlockProbe(id, false, false));
    }

    @Test
    void airAbsorbsNothing() {
        assertEquals(0.0, AbsorptionTable.of(new BlockProbe("minecraft:air", false, false)));
    }

    @Test
    void caveAirAbsorbsNothing() {
        assertEquals(0.0, ofNonSolid("minecraft:cave_air"));
    }

    @Test
    void voidAirAbsorbsNothing() {
        assertEquals(0.0, ofNonSolid("minecraft:void_air"));
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
    void whiteStainedGlassAbsorbsHalf() {
        assertEquals(0.5, of("minecraft:white_stained_glass", false));
    }

    @Test
    void whiteStainedGlassPaneAbsorbsHalf() {
        assertEquals(0.5, of("minecraft:white_stained_glass_pane", false));
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
    void stoneBrickWallAbsorbsOne() {
        assertEquals(1.0, of("minecraft:stone_brick_wall", false));
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
    void woodBlocksAbsorbOne() {
        assertEquals(1.0, of("minecraft:oak_wood", false));
    }

    @Test
    void strippedWoodBlocksAbsorbOne() {
        assertEquals(1.0, of("minecraft:stripped_oak_wood", false));
    }

    @Test
    void stemsAbsorbOne() {
        assertEquals(1.0, of("minecraft:crimson_stem", false));
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
    void openIronDoorAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:iron_door", true));
    }

    @Test
    void openPaleOakDoorAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:pale_oak_door", true));
    }

    @Test
    void closedIronDoorAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:iron_door", false));
    }

    @Test
    void closedPaleOakDoorAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:pale_oak_door", false));
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
    void openCopperTrapdoorAbsorbsNothing() {
        assertEquals(0.0, of("minecraft:copper_trapdoor", true));
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
    void tallGrassAbsorbsNothingWhenNotSolid() {
        assertEquals(0.0, ofNonSolid("minecraft:tall_grass"));
    }

    @Test
    void torchAbsorbsNothingWhenNotSolid() {
        assertEquals(0.0, ofNonSolid("minecraft:torch"));
    }

    @Test
    void anUnknownNonSolidBlockAbsorbsNothing() {
        assertEquals(0.0, ofNonSolid("minecraft:some_future_plant"));
    }

    @Test
    void anUnknownSolidBlockAbsorbsTwo() {
        assertEquals(2.0, of("minecraft:some_future_block", false));
    }

    @Test
    void aNullIdAbsorbsTheDefault() {
        assertEquals(2.0, AbsorptionTable.of(new BlockProbe(null, true, false)));
    }

    @Test
    void slabsStairsCarpetsAndTintedGlassStayAtTheDefault() {
        assertEquals(2.0, of("minecraft:stone_slab", false));
        assertEquals(2.0, of("minecraft:oak_stairs", false));
        assertEquals(2.0, of("minecraft:white_carpet", false));
        assertEquals(2.0, of("minecraft:tinted_glass", false));
    }
}
