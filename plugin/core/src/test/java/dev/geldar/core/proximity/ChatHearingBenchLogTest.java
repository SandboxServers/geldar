package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The MH-8a bench log: one {@code muffle-bench} INFO line per chat line, only when chat.muffle.bench_log is on. */
class ChatHearingBenchLogTest {
    private static final double FEET = 64.0;
    private static final Pattern BENCH_LINE = Pattern.compile(
            "muffle-bench line speaker=(\\S+) tick=(\\d+) listeners=(\\d+) reads=(\\d+) capHit=(true|false) ns=(\\d+)");

    private static ChatHearing.Candidate openAir(String key, double x) {
        return new ChatHearing.Candidate(key, true, x + 0.5, FEET, 0.5);
    }

    private static MuffleSettings withBench(boolean benchLog, int perLineCap) {
        return new MuffleSettings(MuffleConfig.MARGIN, MuffleConfig.SEALED_PENALTY, perLineCap,
                MuffleConfig.PER_RAY_READ_CAP, benchLog);
    }

    private static List<String> benchLines(List<String> log) {
        List<String> out = new ArrayList<>();
        for (String line : log) {
            if (line.startsWith("muffle-bench")) {
                out.add(line);
            }
        }
        return out;
    }

    @Test
    void theBenchFlagIsOffByDefaultAndTheConfigKeepsItsValue() {
        assertFalse(MuffleSettings.defaults().benchLog());
        assertTrue(MuffleSettings.clamped(8.0, 4.0, 512, 64, true, line -> { }).benchLog());
        assertFalse(MuffleSettings.clamped(8.0, 4.0, 512, 64, false, line -> { }).benchLog());
    }

    @Test
    void theFlagOffEmitsNoBenchLineEvenWhenTheBudgetIsSpent() {
        // defaults() is the production path. A spent budget still logs its own counter line, never a muffle-bench line.
        List<String> log = new ArrayList<>();
        new ChatHearing(MuffleSettings.defaults(), log::add).judge(1, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        List<String> spent = new ArrayList<>();
        new ChatHearing(withBench(false, 5), spent::add).judge(1, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        assertTrue(benchLines(log).isEmpty(), log.toString());
        assertTrue(benchLines(spent).isEmpty(), spent.toString());
        assertEquals(1, spent.size(), "only the budget counter line: " + spent);
    }

    @Test
    void theFlagOnEmitsOneLineWithTheKnownReadCount() {
        // The open-air ray from x=0 to x=10 reads 11 cells and no roof scan runs, so reads=11 of 512, capHit=false.
        List<String> log = new ArrayList<>();
        List<ChatHearing.Verdict> v = new ChatHearing(withBench(true, 512), log::add).judge(7, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        assertEquals(Tier.CLEAR, v.get(0).tier());
        List<String> lines = benchLines(log);
        assertEquals(1, lines.size(), log.toString());
        Matcher m = BENCH_LINE.matcher(lines.get(0));
        assertTrue(m.matches(), lines.get(0));
        assertEquals("s", m.group(1));
        assertEquals("7", m.group(2));
        assertEquals("1", m.group(3));
        assertEquals("11", m.group(4));
        assertEquals("false", m.group(5));
        assertTrue(Long.parseLong(m.group(6)) >= 0, lines.get(0));
    }

    @Test
    void readsLandingExactlyOnTheCapWithNoListenerSilencedLogCapHitTrue() {
        // capHit means "the line budget is exhausted, or a listener was silenced by it". The 11-cell open-air ray spends
        // exactly perLineCap=11 and nobody is silenced, so the budget is at 0 and capHit is true with the verdict CLEAR.
        List<String> log = new ArrayList<>();
        List<ChatHearing.Verdict> v = new ChatHearing(withBench(true, 11), log::add).judge(7, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        assertEquals(Tier.CLEAR, v.get(0).tier());
        assertTrue(log.stream().noneMatch(line -> line.startsWith("chat: ")), log.toString());
        List<String> lines = benchLines(log);
        assertEquals(1, lines.size(), log.toString());
        Matcher m = BENCH_LINE.matcher(lines.get(0));
        assertTrue(m.matches(), lines.get(0));
        assertEquals("11", m.group(4));
        assertEquals("true", m.group(5));
    }

    @Test
    void aBudgetThatSilencesAListenerLogsCapHitTrueAndTheSpentReads() {
        // A cap of 5 cuts the 11-cell ray short, so the listener is silenced and the line budget is spent: reads=5.
        List<String> log = new ArrayList<>();
        List<ChatHearing.Verdict> v = new ChatHearing(withBench(true, 5), log::add).judge(7, "s", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        assertEquals(Tier.SILENT, v.get(0).tier());
        List<String> lines = benchLines(log);
        assertEquals(1, lines.size(), log.toString());
        Matcher m = BENCH_LINE.matcher(lines.get(0));
        assertTrue(m.matches(), lines.get(0));
        assertEquals("1", m.group(3));
        assertEquals("5", m.group(4));
        assertEquals("true", m.group(5));
    }

    @Test
    void theBenchLineHoldsOnlyTheFixedFieldsAndNoChatWords() {
        // judge() receives no message text, so the line is built from the speaker, tick, counts and timing alone. The
        // anchored match shows there is no extra field, and the line carries no word a player could have typed.
        List<String> log = new ArrayList<>();
        new ChatHearing(withBench(true, 5), log::add).judge(9, "Alex", 0.5, FEET, 0.5,
                List.of(openAir("p", 10)), new ProbeWorld());
        String line = benchLines(log).get(0);
        assertTrue(BENCH_LINE.matcher(line).matches(), line);
        assertTrue(line.startsWith("muffle-bench line speaker=Alex tick=9 listeners=1 reads=5 capHit=true ns="), line);
    }
}
