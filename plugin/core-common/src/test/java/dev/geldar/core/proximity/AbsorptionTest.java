package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Random;
import org.junit.jupiter.api.Test;

/**
 * The ray model (decision 0199, steps 1 to 3). Speaker feet at (0.5, 0, 0.5), listener feet at (lx + 0.5, 0, lz + 0.5),
 * so both eyes sit in cell y = 1 (eye height 1.62) and a wall placed at y = 1 is on the ray. Raw distance is the eye to
 * eye distance, which equals the horizontal distance here.
 */
class AbsorptionTest {
    private static final double SPEAKER_X = 0.5;
    private static final double SPEAKER_Z = 0.5;
    private static final int CAP = MuffleConfig.PER_RAY_READ_CAP;
    private static final BlockProbe STONE = ProbeWorld.solid("minecraft:stone");
    private static final BlockProbe WOOL = ProbeWorld.solid("minecraft:white_wool");
    private static final BlockProbe TALL_GRASS = new BlockProbe("minecraft:tall_grass", false, false);

    private static Absorption.Effective ray(ProbeWorld world, double listenerX, double listenerZ) {
        return cast(world, SPEAKER_X, 0, SPEAKER_Z, listenerX, 0, listenerZ, CAP);
    }

    private static Absorption.Effective cast(ProbeWorld world, double sx, double sy, double sz,
            double lx, double ly, double lz, int maxReads) {
        return Absorption.effectiveDistance(sx, sy, sz, lx, ly, lz, world, maxReads);
    }

    private static Absorption.Sealed sealed(ProbeWorld world, int y, int maxReads) {
        return Absorption.sealedPenalty(0, y, 0, world, MuffleConfig.DEFAULT_BUILD_LIMIT, maxReads);
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
    void anOpenIronDoorInTheWallAddsNothing() {
        // Raw 10 + an open iron door at 0 = 10. Only the wood types of the old table could open to 0.
        ProbeWorld world = new ProbeWorld().set(5, 1, 0, ProbeWorld.state("minecraft:iron_door", true));
        assertEquals(10.0, ray(world, 10.5, 0.5).distance(), 1e-9);
    }

    @Test
    void aNonSolidMeadowOfTallGrassAddsNothing() {
        // Raw 10 + nine tall grass in the middle at 0 each = 10. The default 2 would give 28.
        ProbeWorld world = new ProbeWorld().setRunX(1, 9, 1, 0, TALL_GRASS);
        Absorption.Effective e = ray(world, 10.5, 0.5);
        assertEquals(10.0, e.distance(), 1e-9);
        assertEquals(11, e.reads());
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
        Absorption.Effective e = cast(world, 0.5, 0, 0.5, 2.5, 0, 1.5, CAP);
        assertEquals(Math.sqrt(5) + 5.0, e.distance(), 1e-9);
        assertFalse(e.cutShort());
    }

    @Test
    void anExactDiagonalInXZIsTheSameBothWays() {
        // Speaker cell (0,1,0), listener (2,1,2). The ray meets the corners (1,1,0) and (0,1,1) at t = 0.25, then
        // (2,1,1) and (1,1,2) at t = 0.75. Stone on the corner (1,1,0) is read both ways: raw 2 sqrt(2) + 2.
        ProbeWorld world = new ProbeWorld().set(1, 1, 0, STONE);
        Absorption.Effective forward = cast(world, 0.5, 0, 0.5, 2.5, 0, 2.5, CAP);
        Absorption.Effective reverse = cast(world, 2.5, 0, 2.5, 0.5, 0, 0.5, CAP);
        assertEquals(2 * Math.sqrt(2) + 2.0, forward.distance(), 1e-9);
        assertEquals(forward.distance(), reverse.distance(), 1e-9);
        assertEquals(7, forward.reads());
        assertEquals(forward.reads(), reverse.reads());
    }

    @Test
    void anExactDiagonalInXYIsTheSameBothWays() {
        // Feet at y = -1.12 and -0.12 put the eyes at exactly y = 0.5 and 1.5. The ray runs from cell (0,0,0) to
        // (1,1,0) through the corner edge shared with (1,0,0) and (0,1,0). Stone on (1,0,0) is read both ways.
        ProbeWorld world = new ProbeWorld().set(1, 0, 0, STONE);
        Absorption.Effective forward = cast(world, 0.5, -1.12, 0.5, 1.5, -0.12, 0.5, CAP);
        Absorption.Effective reverse = cast(world, 1.5, -0.12, 0.5, 0.5, -1.12, 0.5, CAP);
        assertEquals(Math.sqrt(2) + 2.0, forward.distance(), 1e-9);
        assertEquals(forward.distance(), reverse.distance(), 1e-9);
        assertEquals(4, forward.reads());
        assertEquals(forward.reads(), reverse.reads());
    }

    @Test
    void anExactDiagonalInXYZIsTheSameBothWays() {
        // Eyes at y = 0.5 and 1.5, x and z from 0.5 to 1.5: all three axes meet the vertex (1,1,1) at t = 0.5. The six
        // corner-only cells are read on the way, and stone on (1,1,0) is one of them, so it counts both ways.
        ProbeWorld world = new ProbeWorld().set(1, 1, 0, STONE);
        Absorption.Effective forward = cast(world, 0.5, -1.12, 0.5, 1.5, -0.12, 1.5, CAP);
        Absorption.Effective reverse = cast(world, 1.5, -0.12, 1.5, 0.5, -1.12, 0.5, CAP);
        assertEquals(Math.sqrt(3) + 2.0, forward.distance(), 1e-9);
        assertEquals(forward.distance(), reverse.distance(), 1e-9);
        assertEquals(8, forward.reads());
        assertEquals(forward.reads(), reverse.reads());
    }

    @Test
    void aNonDyadicCornerTieIsTheSameBothWays() {
        // The reviewer's example: feet (5.5, 0.5, 0.5) to (2.5, 5.5, 7.5), eyes at y 2.12 and 7.12, so dx = -3, dy = 5,
        // dz = 7. The x and z boundaries meet at t = 0.5 between cells (4,4,3) and (3,4,4), so the corner-only cells
        // (3,4,3) and (4,4,4) are read. Stone on (3,4,3) counts both ways: raw sqrt(83) + 2.
        ProbeWorld world = new ProbeWorld().set(3, 4, 3, STONE);
        Absorption.Effective forward = cast(world, 5.5, 0.5, 0.5, 2.5, 5.5, 7.5, CAP);
        Absorption.Effective reverse = cast(world, 2.5, 5.5, 7.5, 5.5, 0.5, 0.5, CAP);
        assertEquals(Math.sqrt(83) + 2.0, forward.distance(), 1e-9);
        assertEquals(forward.distance(), reverse.distance(), 1e-9);
        assertEquals(forward.reads(), reverse.reads());
        assertFalse(forward.cutShort());
    }

    @Test
    void aThirdsCornerTieIsTheSameBothWays() {
        // Thirds are not dyadic: the x, y and z boundaries meet at one point in exact arithmetic, but the quotients
        // round. The tolerance must still tie them so the corner cell (4,3,5) is read in both directions: raw 3 plus
        // stone 2 = 5.
        ProbeWorld world = new ProbeWorld().set(4, 3, 5, STONE);
        Absorption.Effective f = cast(world, 16.0 / 3, 1.5, 17.0 / 3, 10.0 / 3, 2.5, 23.0 / 3, CAP);
        Absorption.Effective r = cast(world, 10.0 / 3, 2.5, 23.0 / 3, 16.0 / 3, 1.5, 17.0 / 3, CAP);
        assertEquals(5.0, f.distance(), 1e-9);
        assertEquals(5.0, r.distance(), 1e-9);
    }

    @Test
    void twoHundredRandomRaysAreTheSameBothWays() {
        // A fixed random world over x and z from -4 to 8 and y from 0 to 7, about 30% stone and 10% wool, then 200
        // pairs of half-block feet (never on a boundary). Each pair is cast both ways and must agree in distance,
        // reads and cutShort.
        Random random = new Random(42);
        ProbeWorld world = new ProbeWorld();
        for (int x = -4; x <= 8; x++) {
            for (int y = 0; y <= 7; y++) {
                for (int z = -4; z <= 8; z++) {
                    int roll = random.nextInt(10);
                    if (roll < 3) {
                        world.set(x, y, z, STONE);
                    } else if (roll < 4) {
                        world.set(x, y, z, WOOL);
                    }
                }
            }
        }
        for (int i = 0; i < 200; i++) {
            double sx = random.nextInt(13) - 4 + 0.5;
            double sy = random.nextInt(4) + 0.5;
            double sz = random.nextInt(13) - 4 + 0.5;
            double lx = random.nextInt(13) - 4 + 0.5;
            double ly = random.nextInt(4) + 0.5;
            double lz = random.nextInt(13) - 4 + 0.5;
            Absorption.Effective forward = cast(world, sx, sy, sz, lx, ly, lz, CAP);
            Absorption.Effective reverse = cast(world, lx, ly, lz, sx, sy, sz, CAP);
            assertEquals(forward.distance(), reverse.distance(), 1e-9, "pair " + i);
            assertEquals(forward.reads(), reverse.reads(), "pair " + i);
            assertEquals(forward.cutShort(), reverse.cutShort(), "pair " + i);
        }
    }

    @Test
    void aCornerReadCountsTowardTheBudget() {
        // The XZ diagonal reads 7 cells. With a budget of 2 the start and the first corner are read, and the second
        // corner is the one past the budget, so the ray stops there.
        ProbeWorld world = new ProbeWorld().set(1, 1, 0, STONE);
        Absorption.Effective e = cast(world, 0.5, 0, 0.5, 2.5, 0, 2.5, 2);
        assertTrue(e.cutShort());
        assertEquals(2, e.reads());
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
    void theLastAllowedReadIsNotCutShort() {
        // A 10-block line of air is 11 reads: a budget of exactly 11 is the last allowed read.
        Absorption.Effective e = cast(new ProbeWorld(), 0.5, 0, 0.5, 10.5, 0, 0.5, 11);
        assertFalse(e.cutShort());
        assertEquals(11, e.reads());
    }

    @Test
    void oneReadPastTheBudgetIsCutShortAtTheBudget() {
        Absorption.Effective e = cast(new ProbeWorld(), 0.5, 0, 0.5, 10.5, 0, 0.5, 10);
        assertTrue(e.cutShort());
        assertEquals(10, e.reads());
        assertEquals(Tier.SILENT, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aCastWithAShortBudgetStopsThere() {
        Absorption.Effective e = cast(new ProbeWorld(), 0.5, 0, 0.5, 10.5, 0, 0.5, 5);
        assertTrue(e.cutShort());
        assertEquals(5, e.reads());
    }

    @Test
    void aZeroBudgetReadsNothing() {
        Absorption.Effective e = cast(new ProbeWorld(), 0.5, 0, 0.5, 10.5, 0, 0.5, 0);
        assertTrue(e.cutShort());
        assertEquals(0, e.reads());
    }

    @Test
    void aNonFiniteCoordinateIsSilentWithoutReads() {
        Absorption.Effective e = Absorption.effectiveDistance(
                Double.NaN, 0, 0, 1, 0, 1, new ProbeWorld(), CAP);
        assertTrue(e.cutShort());
        assertEquals(0, e.reads());
        assertEquals(Tier.SILENT, Absorption.tier(e.distance(), e.cutShort()));
    }

    @Test
    void aWallOfTwoStoneRunningWestAddsFourToTheRay() {
        // Speaker at x = 10.5, listener at x = 0.5; stone at x = 5 and 4 on the ray: raw 10 + 2 + 2 = 14.
        ProbeWorld world = new ProbeWorld().set(5, 1, 0, STONE).set(4, 1, 0, STONE);
        assertEquals(14.0, cast(world, 10.5, 0, 0.5, 0.5, 0, 0.5, CAP).distance(), 1e-9);
    }

    @Test
    void aWallOfTwoStoneRunningNorthAddsFourToTheRay() {
        // Speaker at z = 10.5, listener at z = 0.5; stone at z = 5 and 4: raw 10 + 4 = 14.
        ProbeWorld world = new ProbeWorld().set(0, 1, 5, STONE).set(0, 1, 4, STONE);
        assertEquals(14.0, cast(world, 0.5, 0, 10.5, 0.5, 0, 0.5, CAP).distance(), 1e-9);
    }

    @Test
    void aWallOfTwoStoneRunningSouthAddsFourToTheRay() {
        // Speaker at z = 0.5, listener at z = 10.5; stone at z = 4 and 5: raw 10 + 4 = 14.
        ProbeWorld world = new ProbeWorld().set(0, 1, 4, STONE).set(0, 1, 5, STONE);
        assertEquals(14.0, cast(world, 0.5, 0, 0.5, 0.5, 0, 10.5, CAP).distance(), 1e-9);
    }

    @Test
    void aWallOfTwoStoneRisingAddsFourToTheRay() {
        // Eyes rise from cell y = 1 to cell y = 11; stone at y = 5 and 6 on the ray: raw 10 + 4 = 14.
        ProbeWorld world = new ProbeWorld().set(0, 5, 0, STONE).set(0, 6, 0, STONE);
        assertEquals(14.0, cast(world, 0.5, 0, 0.5, 0.5, 10, 0.5, CAP).distance(), 1e-9);
    }

    @Test
    void aWallOfTwoStoneFallingAddsFourToTheRay() {
        // Eyes fall from cell y = 11 to cell y = 1; stone at y = 5 and 6 on the ray: raw 10 + 4 = 14.
        ProbeWorld world = new ProbeWorld().set(0, 5, 0, STONE).set(0, 6, 0, STONE);
        assertEquals(14.0, cast(world, 0.5, 10, 0.5, 0.5, 0, 0.5, CAP).distance(), 1e-9);
    }

    @Test
    void aWallOfTwoStoneAtNegativeCoordinatesAddsFourToTheRay() {
        // Speaker at x = -0.5 (cell -1), listener at x = -10.5 (cell -11); stone at x = -4 and -5: raw 10 + 4 = 14.
        ProbeWorld world = new ProbeWorld().set(-4, 1, -1, STONE).set(-5, 1, -1, STONE);
        assertEquals(14.0, cast(world, -0.5, 0, -0.5, -10.5, 0, -0.5, CAP).distance(), 1e-9);
    }

    @Test
    void aRoofOverTheListenerGivesTheSealedPenalty() {
        // Stone at y = 63 above the listener at y = 60: the scan reads 61, 62, 63 and finds the roof.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, CAP);
        assertEquals(MuffleConfig.SEALED_PENALTY, s.penalty(), 1e-9);
        assertEquals(3, s.reads());
    }

    @Test
    void anOpenSkyGivesNoSealedPenaltyAndReadsTheCap() {
        // Open sky reads cells 61 to 124, the whole 64-read budget, and finds no roof.
        Absorption.Sealed s = sealed(new ProbeWorld(), 60, CAP);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(64, s.reads());
    }

    @Test
    void aRoofAtTheLastAllowedReadIsStillFound() {
        // The 64 reads are cells 61 to 124. A roof at 124 is the 64th read.
        ProbeWorld world = new ProbeWorld().set(0, 124, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, CAP);
        assertEquals(MuffleConfig.SEALED_PENALTY, s.penalty(), 1e-9);
        assertEquals(64, s.reads());
    }

    @Test
    void aRoofPastTheReadCapIsNotSeen() {
        // A roof at 125 is the 65th cell: beyond the 64-read budget, so no penalty.
        ProbeWorld world = new ProbeWorld().set(0, 125, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, CAP);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(64, s.reads());
    }

    @Test
    void aSealedScanStopsAtItsOwnBudget() {
        // The roof at 63 is the third read, but the budget is two: the scan stops, so no penalty.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, 2);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(2, s.reads());
    }

    @Test
    void theScanStopsAtTheBuildLimit() {
        // With the build limit at 63 the scan covers y = 61 and 62 only, so a roof at 63 is not reached.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        Absorption.Sealed s = Absorption.sealedPenalty(0, 60, 0, world, 63, CAP);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(2, s.reads());
    }

    @Test
    void aZeroBudgetScanIsTruncated() {
        // No read is made, and the scan has cells left below the build limit, so it is truncated, not clear sky.
        Absorption.Sealed s = sealed(new ProbeWorld(), 60, 0);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(0, s.reads());
        assertTrue(s.truncated());
    }

    @Test
    void aBudgetSpentUnderARoofIsTruncated() {
        // The roof at 70 is ten up. The budget of five reads cells 61 to 65 and stops, so the scan is truncated.
        ProbeWorld world = new ProbeWorld().set(0, 70, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, 5);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(5, s.reads());
        assertTrue(s.truncated());
    }

    @Test
    void aRoofWithinTheBudgetIsNotTruncated() {
        // The roof at 63 is the third read, inside a budget of five: the penalty stands and the scan is complete.
        ProbeWorld world = new ProbeWorld().set(0, 63, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, 5);
        assertEquals(MuffleConfig.SEALED_PENALTY, s.penalty(), 1e-9);
        assertEquals(3, s.reads());
        assertFalse(s.truncated());
    }

    @Test
    void aBudgetEndingExactlyAtTheBuildLimitIsNotTruncated() {
        // Cells 61 and 62 are the two reads, and the build limit is 63: the budget ends exactly there, so the scan is
        // complete, not truncated.
        Absorption.Sealed s = Absorption.sealedPenalty(0, 60, 0, new ProbeWorld(), 63, 2);
        assertEquals(2, s.reads());
        assertFalse(s.truncated());
    }

    @Test
    void aRoofAtTheFifthReadOfABudgetOfFiveIsFoundAndNotTruncated() {
        // Cells 61 to 65 are the five reads; the roof at 65 is the fifth, so the penalty stands and the scan is complete.
        ProbeWorld world = new ProbeWorld().set(0, 65, 0, STONE);
        Absorption.Sealed s = sealed(world, 60, 5);
        assertEquals(4.0, s.penalty(), 1e-9);
        assertEquals(5, s.reads());
        assertFalse(s.truncated());
    }

    @Test
    void openSkyToTheBuildLimitIsNotTruncated() {
        // Open sky reads cells 61 up to the build limit and stops there, which is a complete scan, not a truncated one.
        Absorption.Sealed s = sealed(new ProbeWorld(), 60, 1000);
        assertEquals(0.0, s.penalty(), 1e-9);
        assertEquals(MuffleConfig.DEFAULT_BUILD_LIMIT - 61, s.reads());
        assertFalse(s.truncated());
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
}
