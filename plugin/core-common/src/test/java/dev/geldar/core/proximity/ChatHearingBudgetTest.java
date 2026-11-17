package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The read budget of one chat line, counted at the block reader (decision 0199, steps 3 and 5). */
class ChatHearingBudgetTest {
    private static final double FEET = 64.0;

    /** Counts every read that reaches the block reader, so a test can see what the line spent. */
    private static final class CountingReader implements BlockReader {
        private final BlockReader inner;
        private int reads;

        CountingReader(BlockReader inner) {
            this.inner = inner;
        }

        @Override
        public BlockProbe at(int x, int y, int z) {
            reads++;
            return inner.at(x, y, z);
        }

        @Override
        public int buildLimit() {
            return inner.buildLimit();
        }
    }

    private static ChatHearing.Candidate openAir(String key, double x) {
        return new ChatHearing.Candidate(key, true, x + 0.5, FEET, 0.5);
    }

    @Test
    void anOpenAirListenerInsideClearReadsOnlyItsRay() {
        // The ray from x=0 to x=10 at one height reads 11 cells. Raw 10 plus 4 is still clear, so no roof scan runs.
        CountingReader reader = new CountingReader(new ProbeWorld());
        List<ChatHearing.Verdict> v = hearing(new ArrayList<>()).judge(1, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), reader);
        assertEquals(Tier.CLEAR, v.get(0).tier());
        assertEquals(11, reader.reads);
    }

    @Test
    void twelveOpenAirListenersAllHearAndTheLineKeepsItsBudget() {
        // Each ray reads k + 1 cells, 102 in all. The sealed scan is skipped for each, so the 512 budget is not spent.
        List<String> log = new ArrayList<>();
        CountingReader reader = new CountingReader(new ProbeWorld());
        List<ChatHearing.Candidate> listeners = new ArrayList<>();
        for (int k = 2; k <= 13; k++) {
            listeners.add(openAir("p" + k, k));
        }
        List<ChatHearing.Verdict> v = hearing(log).judge(1, "s", 0.5, FEET, 0.5, listeners, reader);
        for (ChatHearing.Verdict verdict : v) {
            assertEquals(Tier.CLEAR, verdict.tier(), verdict.key());
        }
        assertEquals(12, v.size());
        assertEquals(102, reader.reads);
        assertTrue(log.isEmpty(), "no listener is silenced by the budget: " + log);
    }

    @Test
    void anOpenAirListenerInTheSealedBandStillGetsTheRoofScan() {
        // Raw 30 is clear, but 30 + 4 = 34 is muffled, so the tiers differ and the scan runs: 31 ray reads and 64 scan
        // reads (the per-ray cap). Open sky, so no penalty and the listener stays clear.
        CountingReader reader = new CountingReader(new ProbeWorld());
        List<ChatHearing.Verdict> v = hearing(new ArrayList<>()).judge(1, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 30)), reader);
        assertEquals(Tier.CLEAR, v.get(0).tier());
        assertEquals(31 + MuffleConfig.PER_RAY_READ_CAP, reader.reads);
    }

    private static ChatHearing hearing(List<String> log) {
        return new ChatHearing(MuffleSettings.defaults(), log::add);
    }
}
