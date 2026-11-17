package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Decision 0199 prove-it cases on a block grid: the tiers, the sealed penalty, the budget and the notice. */
class ChatHearingTest {
    private static final double FEET = 64.0;
    private final List<String> logged = new ArrayList<>();

    private ChatHearing hearing(MuffleSettings settings) {
        return new ChatHearing(settings, logged::add);
    }

    /** Speaker at (0.5, 64, 0.5); one listener "l" at (x, 64, 0.5). */
    private List<ChatHearing.Verdict> judgeAlong(ProbeWorld world, double x, boolean sameWorld) {
        return hearing(MuffleSettings.defaults()).judge(1, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", sameWorld, x, FEET, 0.5)), world);
    }

    @Test
    void clearPairWithNoWallsIsHeardAndNotNoticed() {
        List<ChatHearing.Verdict> v = judgeAlong(new ProbeWorld(), 20.5, true);
        assertEquals(Tier.CLEAR, v.get(0).tier());
        assertNull(v.get(0).notice());
    }

    @Test
    void muffledPairBehindAWallGetsOneNoticeAndNoWords() {
        // Raw 30; stone (2) at x=10 and wool (3) at x=11 on the eye row: effective 35, inside the margin.
        ProbeWorld world = new ProbeWorld()
                .set(10, 65, 0, ProbeWorld.solid("minecraft:stone"))
                .set(11, 65, 0, ProbeWorld.solid("minecraft:white_wool"));
        List<ChatHearing.Verdict> v = judgeAlong(world, 30.5, true);
        assertEquals(1, v.size());
        assertEquals(Tier.MUFFLED, v.get(0).tier());
        // The speaker is west of the listener: the voice comes from the west, far band (raw 30).
        assertEquals("w", v.get(0).notice().direction());
        assertEquals("far", v.get(0).notice().band());
    }

    @Test
    void silentPairWithEffectiveFiftyIsNeitherHeardNorNoticed() {
        // Raw 20 with 15 stone blocks (2 each) between: effective 50.
        ProbeWorld world = new ProbeWorld();
        world.setRunX(5, 19, 65, 0, ProbeWorld.solid("minecraft:stone"));
        List<ChatHearing.Verdict> v = judgeAlong(world, 20.5, true);
        assertEquals(Tier.SILENT, v.get(0).tier());
        assertNull(v.get(0).notice());
    }

    @Test
    void aSealedListenerAtThirtyOneBecomesMuffled() {
        // Raw 31 with no wall is clear; a stone roof above the listener adds the sealed penalty 4: effective 35.
        assertEquals(Tier.CLEAR, judgeAlong(new ProbeWorld(), 31.5, true).get(0).tier());
        ProbeWorld sealed = new ProbeWorld().set(31, 66, 0, ProbeWorld.solid("minecraft:stone"));
        assertEquals(Tier.MUFFLED, judgeAlong(sealed, 31.5, true).get(0).tier());
    }

    @Test
    void theSealedPenaltyIsTheConfiguredValue() {
        ProbeWorld sealed = new ProbeWorld().set(31, 66, 0, ProbeWorld.solid("minecraft:stone"));
        MuffleSettings noPenalty = new MuffleSettings(8.0, 0.0, 512, 64);
        List<ChatHearing.Candidate> one = List.of(new ChatHearing.Candidate("l", true, 31.5, FEET, 0.5));
        assertEquals(Tier.CLEAR, hearing(noPenalty).judge(1, "s", 0.5, FEET, 0.5, one, sealed).get(0).tier());
    }

    @Test
    void exactlyThirtyTwoRawWithNoWallIsHeard() {
        assertEquals(Tier.CLEAR, judgeAlong(new ProbeWorld(), 32.5, true).get(0).tier());
    }

    @Test
    void aDifferentWorldIsNeverHeardOrNoticed() {
        assertTrue(judgeAlong(new ProbeWorld(), 5.5, false).isEmpty());
    }

    @Test
    void aLineThatExceedsTheBudgetSilencesTheRestAndLogsOneCounterLine() {
        // Forty listeners in two rows inside the gate. Each keeps its tier with the sealed penalty, so no roof scan runs
        // and only the ray reads spend the 512 budget. The farthest are silenced and one counter line is logged.
        ProbeWorld world = new ProbeWorld();
        List<ChatHearing.Candidate> listeners = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            int x = 2 + (i % 25);
            int z = i / 25;
            world.set(x, 66, z, ProbeWorld.solid("minecraft:stone"));
            listeners.add(new ChatHearing.Candidate("l" + i, true, x + 0.5, FEET, z + 0.5));
        }
        List<ChatHearing.Verdict> v = hearing(MuffleSettings.defaults()).judge(7, "s", 0.5, FEET, 0.5, listeners, world);
        assertTrue(v.stream().anyMatch(x -> x.tier() == Tier.SILENT), "the budget must silence some listeners");
        assertEquals(1, logged.stream().filter(line -> line.contains("silenced by the read budget")).count());
        assertEquals(1, logged.size(), "one counter line per chat line, never the words");
        // Nearest first: the silenced are the farthest. Sorting farthest first would silence the nearest and fail this.
        double maxHeard = -1;
        double minSilenced = Double.MAX_VALUE;
        for (ChatHearing.Verdict verdict : v) {
            int i = Integer.parseInt(verdict.key().substring(1));
            double raw = Math.hypot(2 + (i % 25), i / 25);
            if (verdict.tier() == Tier.SILENT) {
                minSilenced = Math.min(minSilenced, raw);
            } else {
                maxHeard = Math.max(maxHeard, raw);
            }
        }
        assertTrue(maxHeard >= 0, "some listener is heard");
        assertTrue(maxHeard <= minSilenced, "heard up to " + maxHeard + " but silenced from " + minSilenced);
    }

    @Test
    void aSealedScanCutByASpentLineBudgetIsSilent() {
        // Raw 30 is clear with no roof but muffled with the sealed penalty, so the roof scan runs. The ray reads 31
        // cells, exactly the 31-read line budget, so the scan is truncated with nothing left: silent, not clear.
        MuffleSettings settings = new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, 31,
                MuffleConfig.PER_RAY_READ_CAP);
        List<ChatHearing.Verdict> v = hearing(settings).judge(1, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 30.5, FEET, 0.5)), new ProbeWorld());
        assertEquals(Tier.SILENT, v.get(0).tier());
        assertNull(v.get(0).notice());
    }

    @Test
    void aBudgetSilenceInTheRoofScanIsNotCachedForTheTick() {
        // Line one: the roof scan is truncated by the spent budget, so the listener is silent for this line only.
        MuffleSettings settings = new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, 31,
                MuffleConfig.PER_RAY_READ_CAP);
        ChatHearing h = hearing(settings);
        ProbeWorld empty = new ProbeWorld();
        assertEquals(Tier.SILENT, h.judge(5, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 30.5, FEET, 0.5)), empty).get(0).tier());
        // Line two, same tick, same speaker: a fresh budget reads 13 cells, and the listener is heard.
        assertEquals(Tier.CLEAR, h.judge(5, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 12.5, FEET, 0.5)), empty).get(0).tier());
    }

    @Test
    void aBudgetSilenceInTheRayIsNotCachedForTheTick() {
        // Line one: "a" reads 11 cells, so "l" has 9 left against its 13 and is cut short by the budget.
        MuffleSettings settings = new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, 20,
                MuffleConfig.PER_RAY_READ_CAP);
        ChatHearing h = hearing(settings);
        ProbeWorld empty = new ProbeWorld();
        List<ChatHearing.Candidate> both = List.of(new ChatHearing.Candidate("a", true, 10.5, FEET, 0.5),
                new ChatHearing.Candidate("l", true, 12.5, FEET, 0.5));
        assertEquals(Tier.SILENT, h.judge(6, "s", 0.5, FEET, 0.5, both, empty).get(1).tier());
        assertEquals(Tier.CLEAR, h.judge(6, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 12.5, FEET, 0.5)), empty).get(0).tier());
    }

    @Test
    void anUnloadedRayReadIsSilentNotCachedAndSpendsOneRead() {
        // "a" (raw 5) is cast first and its first read throws. "b" (raw 10) needs 11 reads; the throw spent one of
        // the 11, so 10 are left, b's ray is cut short and b is silent.
        ChatHearing h = hearing(new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, 11,
                MuffleConfig.PER_RAY_READ_CAP));
        List<ChatHearing.Candidate> both = List.of(new ChatHearing.Candidate("a", true, 5.5, FEET, 0.5),
                new ChatHearing.Candidate("b", true, 10.5, FEET, 0.5));
        List<ChatHearing.Verdict> v = h.judge(9, "s", 0.5, FEET, 0.5, both, new FirstReadUnloaded());
        assertEquals(Tier.SILENT, v.get(0).tier());
        assertEquals(Tier.SILENT, v.get(1).tier());
        // Not cached: the same speaker and listener in the same tick is cast again and heard.
        assertEquals(Tier.CLEAR, h.judge(9, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("a", true, 5.5, FEET, 0.5)), new ProbeWorld()).get(0).tier());
    }

    @Test
    void anUnloadedRoofReadIsSilentAndSpendsOneRead() {
        // "a" (raw 30) reads its 31-cell ray, then its roof scan throws at x=30 above y=65. The throw spent one of the
        // 34 left, so 33 remain. "b" (raw 31, 32 cells) then needs a roof scan with 1 read left: its scan is truncated
        // and b is silent. Without the spent read b would have 34 left, read its ray, and find the roof at (31, 66, 0).
        ChatHearing h = hearing(new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, 65,
                MuffleConfig.PER_RAY_READ_CAP));
        List<ChatHearing.Candidate> both = List.of(new ChatHearing.Candidate("a", true, 30.5, FEET, 0.5),
                new ChatHearing.Candidate("b", true, 31.5, FEET, 0.5));
        List<ChatHearing.Verdict> v = h.judge(9, "s", 0.5, FEET, 0.5, both, new RoofUnloaded());
        assertEquals(Tier.SILENT, v.get(0).tier());
        assertEquals(Tier.SILENT, v.get(1).tier());
    }

    @Test
    void anUnloadedRoofReadIsNotCachedForTheTick() {
        ChatHearing h = hearing(MuffleSettings.defaults());
        List<ChatHearing.Candidate> one = List.of(new ChatHearing.Candidate("a", true, 30.5, FEET, 0.5));
        assertEquals(Tier.SILENT, h.judge(9, "s", 0.5, FEET, 0.5, one, new RoofUnloaded()).get(0).tier());
        assertEquals(Tier.CLEAR, h.judge(9, "s", 0.5, FEET, 0.5, one, new ProbeWorld()).get(0).tier());
    }

    @Test
    void aNorthSpeakerOnTheZAxisGivesTheNorthNotice() {
        // Listener at z=30.5, speaker at z=0.5 (north is -z). Stone and wool on the z axis make the voice muffled.
        ProbeWorld world = new ProbeWorld()
                .set(0, 65, 10, ProbeWorld.solid("minecraft:stone"))
                .set(0, 65, 11, ProbeWorld.solid("minecraft:white_wool"));
        List<ChatHearing.Verdict> v = hearing(MuffleSettings.defaults()).judge(1, "s", 0.5, FEET, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 0.5, FEET, 30.5)), world);
        assertEquals(Tier.MUFFLED, v.get(0).tier());
        assertEquals("n", v.get(0).notice().direction());
        assertEquals("far", v.get(0).notice().band());
    }

    @Test
    void aSpeakerDirectlyAboveAMuffledListenerGivesTheOverheadNotice() {
        // Speaker at (0.5, 94, 0.5), listener at (0.5, 64, 0.5): raw 30, dy +30. Wool at (0, 80, 0) on the ray adds 3:
        // effective 33, just inside muffled. Both offsets horizontal are zero, so the notice is overhead, not north.
        ProbeWorld world = new ProbeWorld().set(0, 80, 0, ProbeWorld.solid("minecraft:white_wool"));
        List<ChatHearing.Verdict> v = hearing(MuffleSettings.defaults()).judge(1, "s", 0.5, 94, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 0.5, FEET, 0.5)), world);
        assertEquals(Tier.MUFFLED, v.get(0).tier());
        assertEquals("overhead", v.get(0).notice().direction());
        assertEquals("far", v.get(0).notice().band());
    }

    @Test
    void aSpeakerDirectlyBelowAMuffledListenerGivesTheBelowNotice() {
        // Speaker at (0.5, 34, 0.5), listener at (0.5, 64, 0.5): raw 30, dy -30. Wool at (0, 50, 0) adds 3.
        ProbeWorld world = new ProbeWorld().set(0, 50, 0, ProbeWorld.solid("minecraft:white_wool"));
        List<ChatHearing.Verdict> v = hearing(MuffleSettings.defaults()).judge(1, "s", 0.5, 34, 0.5,
                List.of(new ChatHearing.Candidate("l", true, 0.5, FEET, 0.5)), world);
        assertEquals(Tier.MUFFLED, v.get(0).tier());
        assertEquals("below", v.get(0).notice().direction());
        assertEquals("far", v.get(0).notice().band());
    }

    /** Throws UnloadedBlock on the first read only, then reads air. */
    private static final class FirstReadUnloaded implements BlockReader {
        private boolean thrown;

        @Override
        public BlockProbe at(int x, int y, int z) {
            if (!thrown) {
                thrown = true;
                throw new UnloadedBlock();
            }
            return ProbeWorld.AIR;
        }
    }

    /** Throws UnloadedBlock for the column x=30 at and above y=66, which only a roof scan reads; air elsewhere. */
    private static final class RoofUnloaded implements BlockReader {
        @Override
        public BlockProbe at(int x, int y, int z) {
            if (x == 30 && y >= 66) {
                throw new UnloadedBlock();
            }
            if (x == 31 && y == 66) {
                return ProbeWorld.solid("minecraft:stone");
            }
            return ProbeWorld.AIR;
        }
    }

    @Test
    void aCastCachedForTheTickIsNotCastAgain() {
        ChatHearing h = hearing(MuffleSettings.defaults());
        List<ChatHearing.Candidate> one = List.of(new ChatHearing.Candidate("l", true, 20.5, FEET, 0.5));
        assertEquals(Tier.CLEAR, h.judge(3, "s", 0.5, FEET, 0.5, one, new ProbeWorld()).get(0).tier());
        // Same tick: the cached verdict is returned even with a reader that would silence everything.
        ProbeWorld blocked = new ProbeWorld();
        blocked.setRunX(5, 19, 65, 0, ProbeWorld.solid("minecraft:stone"));
        assertEquals(Tier.CLEAR, h.judge(3, "s", 0.5, FEET, 0.5, one, blocked).get(0).tier());
        assertEquals(Tier.SILENT, h.judge(4, "s", 0.5, FEET, 0.5, one, blocked).get(0).tier());
    }
}
