package dev.geldar.ledger.neoforge.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The hardened mask (normalisation, delimiters, squash pass, input cap), the command name check, and the fail-closed wiring. */
class NameMaskHardeningTest {
    final FakeLedger f = new FakeLedger();
    final AtomicLong clock = new AtomicLong(1_000_000_000L);

    private static String mask(String text, String... names) {
        return new NameMask().mask(text, Arrays.asList(names));
    }

    @Test
    void unicodeFormsOfTheNameAreMasked() {
        String[] forms = {
            "\uff33\uff54\uff45\uff56\uff45", // fullwidth
            "\u24c8\u24e3\u24d4\u24e5\u24d4", // circled
            "St\u200beve", // zero-width space
            "Ste\u00adve", // soft hyphen
            "Ste\u0301ve", // combining acute
            "\u202eSteve", // RTL override
            "\u0405teve", // Cyrillic S
            "Ste\u0432e".replace('\u0432', '\u0475'), // Cyrillic v lookalike
            "STEVE", "sTeVe",
            "\ud835\udc12\ud835\udc2d\ud835\udc1e\ud835\udc2f\ud835\udc1e", // mathematical bold
        };
        for (String form : forms) {
            String out = mask("ping " + form + " now", "Steve");
            assertEquals("ping <human> now", out.replace("\u202e", ""), form); // an invisible mark may stay outside the span
        }
        assertEquals("<human>", mask("STRA\u1e9eE", "strasse"));
        assertEquals("<human>", mask("Stra\u00dfe", "Strasse"));
        assertEquals("<human>", mask("\u0131stanbul", "istanbul"));
        assertEquals("<human>", mask("\u0130STANBUL", "istanbul"));
        assertEquals("<human>", mask("\u212aevin", "kevin"));
    }

    @Test
    void theOriginalSpanIsReplacedNotTheFoldedOne() {
        assertEquals("x <human>! y", mask("x Ste\u200bve! y", "Steve"));
    }

    @Test
    void shortNamesUseUnderscoreDigitsAndPunctuationAsDelimiters() {
        assertEquals("<human>_Smith", mask("Bob_Smith", "Bob"));
        assertEquals("<human>2 <human>9 1<human>", mask("Bob2 BOB9 1bob", "Bob"));
        assertEquals("<human>.", mask("Bob.", "Bob"));
        assertEquals("<human>-x", mask("bob-x", "Bob"));
        // the stated weakness: a short name inside a longer word is not masked
        assertEquals("Bobby xbobx", mask("Bobby xbobx", "Bob"));
    }

    @Test
    void spacedOutNamesAreDroppedNotExported() {
        for (String text : new String[] {"S t e v e", "S.t.e.v.e", "s-t-e-v-e", "S_t_e_v_e", "St e ve", "S\u200b.t,e;v!e"}) {
            assertThrows(IllegalStateException.class, () -> mask("hello " + text + " there", "Steve"), text);
        }
    }

    @Test
    void normalMessagesAreNotDropped() {
        assertEquals("the build is done, see you at the base", mask("the build is done, see you at the base", "Steve", "Zorbo"));
        assertEquals("<human> and <human> went home", mask("Steve and Zorbo went home", "Steve", "Zorbo"));
        assertEquals("ag_ada_01 says hi to ag_steve_02", mask("ag_ada_01 says hi to ag_steve_02", "Steve", "ada1"));
        assertEquals("", mask("", "Steve"));
        assertEquals("a b c d", mask("a b c d", "Steve"));
    }

    @Test
    void aWordThatSquashesIntoAKnownNameIsARareFalseDrop() {
        assertThrows(IllegalStateException.class, () -> mask("its t eve now", "Steve".replace("S", "ts")));
    }

    @Test
    void inputIsCutToTheCapBeforeMatching() {
        String text = "x".repeat(NameMask.INPUT_MAX) + " Steve";
        assertEquals("x".repeat(NameMask.INPUT_MAX), mask(text, "Steve"));
    }

    private static long best(Runnable r) {
        long best = Long.MAX_VALUE;
        for (int i = 0; i < 5; i++) {
            long t0 = System.nanoTime();
            r.run();
            best = Math.min(best, System.nanoTime() - t0);
        }
        return best;
    }

    @Test
    void hostileInputAgainstManyNamesIsBoundedAndScalesLinearly() {
        NameMask m = new NameMask(8192);
        for (int i = 0; i < 8192; i++) {
            m.seen("nm" + "abcdefghijklmnop".substring(0, 1 + i % 14) + i);
        }
        List<String> none = new ArrayList<>();
        String big = "a".repeat(NameMask.INPUT_MAX);
        String small = "a".repeat(NameMask.INPUT_MAX / 4);
        best(() -> m.mask(big, none)); // warm up
        long tBig = best(() -> m.mask(big, none));
        long tSmall = best(() -> m.mask(small, none));
        assertTrue(tBig < 1_500_000_000L, "4096 chars took " + tBig / 1_000_000 + " ms");
        // a quarter of the input must cost well under the whole (quadratic work would be 1/16, linear 1/4): allow 12x
        assertTrue(tBig <= Math.max(tSmall, 200_000L) * 12, "big " + tBig + " ns, small " + tSmall + " ns");
        String words = "abcd ".repeat(NameMask.INPUT_MAX / 5);
        assertTrue(best(() -> m.mask(words, none)) < 1_500_000_000L);
    }

    // --- command name is a registered root command only ---

    private static final Set<String> ROOTS = Set.of("say", "msg", "me", "execute", "list", "tell");

    private static CommandText.Parsed cmd(String raw) {
        return CommandText.parse(raw, ROOTS::contains);
    }

    @Test
    void onlyRegisteredRootCommandsAreExportedAsTheName() {
        assertEquals("unknown", cmd("hunter2").name());
        assertEquals("unknown", cmd("Steve hello").name());
        assertEquals("unknown", cmd("a:b:Steve x").name());
        assertEquals("say", cmd("minecraft:say x").name());
        assertEquals("unknown", cmd("execute as @e[name=\"x run Steve b\"] run").name());
        assertEquals("unknown", cmd("execute as Steve run Steve").name());
        assertEquals("say", cmd("execute as @a run say hi").name());
        assertEquals("login", cmd("login hunter2").name()); // auth verbs stay, with count 0
        assertEquals(0, cmd("login hunter2").argCount());
        assertEquals(1, cmd("say hi").argCount());
    }

    @Test
    void familyAppliesTheRegisteredPredicateOnBothSources() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command("console", false, () -> "Steve hello", ROOTS::contains);
        a.command("rcon", false, () -> "say hello", ROOTS::contains);
        assertEquals("unknown", f.events.get(0)[4]);
        assertEquals("say", f.events.get(1)[4]);
        assertFalse(Arrays.deepToString(f.events.get(0)).toLowerCase().contains("steve"));
    }

    // --- fail-closed default ---

    @Test
    void theDefaultNameSourceFailsClosed() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, "Zorbo", "w", () -> "hello");
        assertTrue(f.content.isEmpty());
        assertEquals(1, t.maskDrops());
    }

    @Test
    void aSquashDropIsCountedAndNothingIsRecorded() {
        TextContentFamily t = f.text(clock::get);
        t.noteName("Steve");
        t.chat(false, "Zorbo", "w", () -> "S t e v e is here");
        assertTrue(f.content.isEmpty());
        assertEquals(1, t.maskDrops());
        t.chat(false, "Zorbo", "w", () -> "Steve is here");
        assertEquals(1, f.content.size());
    }
}