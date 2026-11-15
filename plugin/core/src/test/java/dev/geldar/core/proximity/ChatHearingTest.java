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
        // Forty listeners in two rows inside the gate, each under a roof, so its sealed scan reads two cells and the
        // ray reads spend the 512 budget. The farthest are silenced and one counter line is logged.
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
