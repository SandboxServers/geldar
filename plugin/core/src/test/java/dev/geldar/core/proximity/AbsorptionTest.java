package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * The ray model (decision 0199, steps 1 to 3). Speaker feet at (0.5, 0, 0.5), listener feet at (lx + 0.5, 0, lz + 0.5),
 * so both eyes sit in cell y = 1 (eye height 1.62) and a wall placed at y = 1 is on the ray. Raw distance is the eye to
 * eye distance, which equals the horizontal distance here.
 */
class AbsorptionTest {
    private static final double SPEAKER_X = 0.5;
    private static final double SPEAKER_Z = 0.5;
    private static final BlockProbe STONE = ProbeWorld.solid("minecraft:stone");
    private static final BlockProbe WOOL = ProbeWorld.solid("minecraft:white_wool");

    private static Absorption.Effective ray(ProbeWorld world, double listenerX, double listenerZ) {
        return Absorption.effectiveDistance(SPEAKER_X, 0, SPEAKER_Z, listenerX, 0, listenerZ, world);
    }

    @Test
    void aLineOfAirGivesTheRawDistance() {
        Absorption.Effective e = ray(new ProbeWorld(), 10.5, 0.5);
        assertEquals(10.0, e.distance(), 1e-9);
        assertFalse(e.cutShort());
    }

    @Test
    void aStraightWallOfThreeStoneAtRawTenGivesSixteen() {
        // Raw 10 + three stone blocks at 2 each = 10 + 6 = 16. Clear, since 16 <= 32.
        ProbeWorld world = new ProbeWorld().setRunX(5, 7, 1, 0, STONE);
        Absorption.Effective e = ray(world, 10.5, 0.5);
        assertEquals(16.0, e.distance(), 1e-9);
        assertEquals(Tier.CLEAR, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aFiveBlockWoolWallAtRawTwentyIsMuffled() {
        // Raw 20 + five wool blocks at 3 each = 20 + 15 = 35. Muffled, since 32 < 35 <= 40.
        ProbeWorld world = new ProbeWorld().setRunX(5, 9, 1, 0, WOOL);
        Absorption.Effective e = ray(world, 20.5, 0.5);
        assertEquals(35.0, e.distance(), 1e-9);
        assertEquals(Tier.MUFFLED, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aThreeBlockWoolWallAtRawTwentyStaysClear() {
        // Raw 20 + three wool blocks at 3 each = 20 + 9 = 29. Clear, since 29 <= 32.
        ProbeWorld world = new ProbeWorld().setRunX(5, 7, 1, 0, WOOL);
        Absorption.Effective e = ray(world, 20.5, 0.5);
        assertEquals(29.0, e.distance(), 1e-9);
        assertEquals(Tier.CLEAR, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aFifteenBlockWoolWallAtRawThirtyIsSilent() {
        // Raw 30 + fifteen wool blocks at 3 each = 30 + 45 = 75. Silent, since 75 > 40.
        ProbeWorld world = new ProbeWorld().setRunX(1, 15, 1, 0, WOOL);
        Absorption.Effective e = ray(world, 30.5, 0.5);
        assertEquals(75.0, e.distance(), 1e-9);
        assertEquals(Tier.SILENT, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void anOpenDoorInTheWallAddsNothing() {
        // Raw 10 + an open oak door at 0 = 10.
        ProbeWorld world = new ProbeWorld().set(5, 1, 0, ProbeWorld.state("minecraft:oak_door", true));
        assertEquals(10.0, ray(world, 10.5, 0.5).distance(), 1e-9);
    }

    @Test
    void aClosedDoorInTheWallAddsTwo() {
        // Raw 10 + a closed oak door at 2 = 12.
        ProbeWorld world = new ProbeWorld().set(5, 1, 0, ProbeWorld.state("minecraft:oak_door", false));
        assertEquals(12.0, ray(world, 10.5, 0.5).distance(), 1e-9);
    }

    @Test
    void aDiagonalRayCountsEachCrossedBlockOnce() {
        // Speaker cell (0,0), listener cell (2,1). The ray x = 0.5 + 2t, z = 0.5 + t crosses, in order, the cells
        // (0,0) own, (1,0), (1,1), (2,1) own. Stone at (1,1,0) adds 2, wool at (1,1,1) adds 3. The stone at (2,1,0)
        // is not on the ray and must add nothing. Raw = sqrt(2^2 + 1^2) = sqrt(5). Expected = sqrt(5) + 5.
        ProbeWorld world = new ProbeWorld()
                .set(1, 1, 0, STONE)
                .set(1, 1, 1, WOOL)
                .set(2, 1, 0, STONE);
        Absorption.Effective e = Absorption.effectiveDistance(0.5, 0, 0.5, 2.5, 0, 1.5, world);
        assertEquals(Math.sqrt(5) + 5.0, e.distance(), 1e-9);
        assertFalse(e.cutShort());
    }

    @Test
    void aSolidListenerCellIsCounted() {
        // The listener's own cell adds its absorption only when solid: raw 10 + stone 2 = 12.
        ProbeWorld world = new ProbeWorld().set(10, 1, 0, STONE);
        assertEquals(12.0, ray(world, 10.5, 0.5).distance(), 1e-9);
    }

    @Test
    void aNonSolidSpeakerCellIsNotCounted() {
        // Water in the speaker's own cell is not solid, so it adds nothing: raw 10.
        ProbeWorld world = new ProbeWorld().set(0, 1, 0, new BlockProbe("minecraft:water", false, false));
        assertEquals(10.0, ray(world, 10.5, 0.5).distance(), 1e-9);
    }

    @Test
    void aRayOverSixtyFourReadsIsCutShortAndSilent() {
        // A 100-block line of air needs 101 reads. The ray stops at 64, reports cutShort, and is silent.
        Absorption.Effective e = ray(new ProbeWorld(), 100.5, 0.5);
        assertTrue(e.cutShort());
        assertEquals(MuffleConfig.PER_RAY_READ_CAP, e.reads());
        assertEquals(Tier.SILENT, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aRayOfExactlySixtyFourCellsIsNotCutShort() {
        // Cells 0 to 63 are 64 reads: the whole ray fits the cap.
        Absorption.Effective e = ray(new ProbeWorld(), 63.5, 0.5);
        assertFalse(e.cutShort());
        assertEquals(64, e.reads());
    }

    @Test
    void aNonFiniteCoordinateIsSilentWithoutReads() {
        Absorption.Effective e = Absorption.effectiveDistance(
                Double.NaN, 0, 0, 1, 0, 1, new ProbeWorld());
        assertTrue(e.cutShort());
        assertEquals(0, e.reads());
        assertEquals(Tier.SILENT, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void theClearLimitIsInclusive() {
        assertEquals(Tier.CLEAR, Absorption.tier(32.0, false));
    }

    @Test
    void justPastTheClearLimitIsMuffled() {
        assertEquals(Tier.MUFFLED, Absorption.tier(32.0001, false));
    }

    @Test
    void theMarginEndIsInclusive() {
        assertEquals(Tier.MUFFLED, Absorption.tier(40.0, false));
    }

    @Test
    void justPastTheMarginIsSilent() {
        assertEquals(Tier.SILENT, Absorption.tier(40.0001, false));
    }

    @Test
    void aCutShortRayIsSilentWhateverItsDistance() {
        assertEquals(Tier.SILENT, Absorption.tier(10.0, true));
    }

    @Test
    void aRoofOverTheListenerGivesTheSealedPenalty() {
        // Stone at y = 63 above the listener at y = 60: the scan reads 61, 62, 63 and finds the roof.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        assertEquals(MuffleConfig.SEALED_PENALTY, Absorption.sealedPenalty(0, 60, 0, world), 1e-9);
    }

    @Test
    void anOpenSkyGivesNoSealedPenalty() {
        assertEquals(0.0, Absorption.sealedPenalty(0, 60, 0, new ProbeWorld()), 1e-9);
    }

    @Test
    void aRoofAtTheLastAllowedReadIsStillFound() {
        // The 64 reads are cells 61 to 124. A roof at 124 is the 64th read.
        ProbeWorld world = new ProbeWorld().set(0, 124, 0, STONE);
        assertEquals(MuffleConfig.SEALED_PENALTY, Absorption.sealedPenalty(0, 60, 0, world), 1e-9);
    }

    @Test
    void aRoofPastTheReadCapIsNotSeen() {
        // A roof at 125 is the 65th cell: beyond the 64-read budget, so no penalty.
        ProbeWorld world = new ProbeWorld().set(0, 125, 0, STONE);
        assertEquals(0.0, Absorption.sealedPenalty(0, 60, 0, world), 1e-9);
    }

    @Test
    void theScanStopsAtTheBuildLimit() {
        // With the build limit at 63 the scan covers y = 61 and 62 only, so a roof at 63 is not reached.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        assertEquals(0.0, Absorption.sealedPenalty(0, 60, 0, world, 63), 1e-9);
    }
}
