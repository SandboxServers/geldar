package dev.geldar.ledger.neoforge.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/** The human-chat name mask (owner direct 2026-11-17, record 0375), with fake names only. */
class NameMaskTest {
    private static final String AGENT = "ag_ada_01";
    final FakeLedger f = new FakeLedger();
    final AtomicLong clock = new AtomicLong(1_000_000_000L);

    private static String mask(NameMask m, String text, String... names) {
        return m.mask(text, java.util.Arrays.asList(names));
    }

    @Test
    void speakerAndOtherOnlineHumansAreMaskedCaseInsensitively() {
        NameMask m = new NameMask();
        assertEquals("hi <human> and <human> and <human>", mask(m, "hi Zorbo and ZORBO and zOrBo", "Zorbo"));
        assertEquals("<human> meet <human>", mask(m, "Zorbo meet Quillan", "Zorbo", "Quillan"));
    }

    @Test
    void nameInsideALongerWordIsMaskedForFourOrMoreCharacters() {
        NameMask m = new NameMask();
        assertEquals("<human>s base, <human>_fan", mask(m, "Zorbos base, Zorbo_fan", "Zorbo"));
        assertEquals("x<human>y", mask(m, "xZorboy", "Zorbo"));
        assertEquals("<human><human>", mask(m, "ZorboZorbo", "Zorbo"));
    }

    @Test
    void shortNamesAreMaskedAsWholeTokensOnly() {
        NameMask m = new NameMask();
        assertEquals("hi <human>, a <human>.", mask(m, "hi Bob, a bob.", "Bob"));
        assertEquals("bobcat bobby", mask(m, "bobcat bobby", "Bob"));
        assertEquals("Ed is edible", mask(m, "Ed is edible", "Edgar"));
        assertEquals("<human> is edible", mask(m, "Ed is edible", "Ed"));
        // exactly 3 and exactly 4 characters: the boundary
        assertEquals("abcd", mask(m, "abcd", "abc"));
        assertEquals("<human>d <human>", mask(m, "abcdd abcd", "abcd"));
    }

    @Test
    void agentNamesAreNeverMasked() {
        NameMask m = new NameMask();
        m.seen(AGENT);
        m.seen("ada");
        assertEquals("hello " + AGENT + " from <human>", mask(m, "hello " + AGENT + " from ada", AGENT));
        assertEquals("ag_ada_02 and " + AGENT, mask(m, "ag_ada_02 and " + AGENT, AGENT, "ag_ada_02"));
        // a human named like a fragment of an agent name does not damage the agent token
        assertEquals(AGENT, mask(m, AGENT, "ada"));
    }

    @Test
    void uuidShapesAreMaskedAndNamesInsideThemDoNotBreakIt() {
        NameMask m = new NameMask();
        String u = "123e4567-e89b-12d3-a456-426614174000";
        assertEquals("id <uuid> and <uuid>.", mask(m, "id " + u + " and " + u.toUpperCase() + ".", "xyzzy"));
        assertEquals("<uuid>", mask(m, "dead0000beef0000dead0000beef0000", "dead", "beef"));
        assertEquals("<uuid> <human>", mask(m, "dead0000-beef-0000-dead-0000beef0000 dead", "dead"));
    }

    @Test
    void emptyAndNullTextAreEmpty() {
        NameMask m = new NameMask();
        assertEquals("", m.mask(null, List.of("Zorbo")));
        assertEquals("", m.mask("", List.of("Zorbo")));
        assertEquals("plain", m.mask("plain", List.of()));
        assertEquals("plain", mask(m, "plain", (String) null, "", "has space", "x".repeat(40)));
    }

    @Test
    void largeTextIsMaskedInLinearTime() {
        NameMask m = new NameMask();
        for (int i = 0; i < NameMask.SEEN_MAX; i++) {
            m.seen("name" + i);
        }
        String text = ("lorem Zorbo ipsum name7 dolor aaaaaaaaaaaa ").repeat(800); // about 33 KB
        assertTrue(text.length() > 32 * 1024);
        long t0 = System.nanoTime();
        String out = mask(m, text, "Zorbo");
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertFalse(out.contains("Zorbo") || out.contains("name7"));
        assertTrue(ms < 2000, "took " + ms + " ms");
        String single = "a".repeat(40_000);
        t0 = System.nanoTime();
        mask(m, single, "aaaa");
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 2000);
    }

    @Test
    void seenSetIsBoundedAndEvictsTheOldest() {
        NameMask m = new NameMask(3);
        for (String n : new String[] {"alpha", "bravo", "charlie", "delta"}) {
            m.seen(n);
        }
        assertEquals(3, m.seenSize());
        assertEquals("alpha <human> <human> <human>", mask(m, "alpha bravo charlie delta"));
        m.seen("bravo"); // seen again: newest
        m.seen("echo");
        assertEquals("<human> charlie <human> <human>", mask(m, "bravo charlie delta echo"));
        m.seen(AGENT);
        m.seen(null);
        assertEquals(3, m.seenSize());
        assertEquals(4096, NameMask.SEEN_MAX);
    }

    // --- inside the family: order, fail closed, switch ---

    private TextContentFamily family(Supplier<java.util.Collection<String>> online) {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.onlineNames(online);
        return t;
    }

    @Test
    void familyMasksBeforeRecordingAndNeverExportsTheSpeaker() {
        TextContentFamily t = family(() -> List.of("Quillan", AGENT));
        t.noteName("Seenfirst");
        t.chat(false, "Zorbo", "w", () -> "Zorbo says hi to Quillan, Seenfirst and " + AGENT + " 123e4567-e89b-12d3-a456-426614174000");
        assertEquals(1, f.content.size());
        String[] c = f.content.get(0);
        String all = String.join("|", java.util.Arrays.stream(c).map(String::valueOf).toList());
        assertTrue(all.contains("<human> says hi to <human>, <human> and " + AGENT + " <uuid>"), all);
        assertFalse(all.contains("Zorbo") || all.contains("Quillan") || all.contains("Seenfirst"), all);
    }

    @Test
    void aThrowingNameSourceFailsClosedAndCountsADrop() {
        TextContentFamily t = family(() -> {
            throw new IllegalStateException("no server");
        });
        t.chat(false, "Zorbo", "w", () -> "Zorbo hello");
        assertTrue(f.content.isEmpty());
        assertEquals(1, t.maskDrops());
        long drops = f.events.stream().filter(e -> (int) e[0] == f.registered.indexOf("geldar.chat._rate_drop")).count();
        assertEquals(1, drops);
        assertEquals(0, t.errors());
    }

    @Test
    void aNullNameListFailsClosed() {
        TextContentFamily t = family(() -> null);
        t.chat(false, "Zorbo", "w", () -> "Zorbo hello");
        assertTrue(f.content.isEmpty());
        assertEquals(1, t.maskDrops());
    }
}