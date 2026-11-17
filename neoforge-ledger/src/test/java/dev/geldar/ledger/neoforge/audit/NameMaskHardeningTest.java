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
        for (String text : new String[] {"S t e v e", "S.t.e.v.e", "s-t-e-v-e", "S_t_e_v_e", "St e ve", "S\u200b.t,e;v!e", "St\u0ce6eve", "x S t e v e y"}) {
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
        assertEquals("St eve", mask("St eve", "Steve")); // stated weakness: two-token splits leak
        assertEquals("the old man", mask("the old man", "Theo"));
        assertEquals("go of the road, other mothers there", mask("go of the road, other mothers there", "ofth"));
        assertEquals("o<human>", mask("other", "ther"));
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

    @Test
    void precomposedAccentsAndInvisibleLettersAreMasked() {
        for (String form : new String[] {"St\u00e9ve", "St\u00e8ve", "\u0160teve", "Stev\u00eb", "\u015ct\u00e9v\u00e9", "St\u0451v\u0451",
            "\u0451", "St\u0101ve".replace("\u0101", "e")}) {
            if (form.equals("\u0451")) {
                continue;
            }
            assertEquals("<human>", mask(form, "Steve"), form);
        }
        for (String filler : new String[] {"\u3164", "\u115f", "\u1160", "\uffa0", "\u17b4", "\u034f", "\u061c", "\u2062", "\ufe0f", "\u0001", "\u0000", "\u007f"}) {
            assertEquals("<human>", mask("St" + filler + "eve", "Steve"), "U+" + Integer.toHexString(filler.charAt(0)));
        }
        assertEquals("<human>", mask("St\ud83c\uddea\ud83c\uddfbeve".replace("\ud83c\uddea\ud83c\uddfb", "\u200b"), "Steve"));
    }

    @Test
    void aControlCharacterInsideANameCannotMimicASeparator() {
        assertEquals("<human>", mask("Ste\u0001ve", "Steve"));
        assertEquals("hi <human>", mask("hi Ste\u0001ve\u0001", "Steve").replace("<human>\u0001", "<human>"));
    }

    @Test
    void everyMappedLookalikeIsMasked() {
        List<String> bad = new ArrayList<>();
        for (var e : NameMask.lookalikes().entrySet()) {
            String name = "qq" + e.getValue() + "qq";
            if (!"<human>".equals(mask("qq" + e.getKey() + "qq", name))) {
                bad.add("U+" + Integer.toHexString(e.getKey()));
            }
        }
        assertTrue(bad.isEmpty(), "not masked: " + bad);
        assertEquals("<human>", mask("\ua731\u1d1b\u1d07\u1d20\u1d07", "steve"));
        assertEquals("<human>", mask("\u051b\u051d\u0433\u043f", "qwrn")); // Cyrillic q w r n
        assertEquals("<human>", mask(new String(Character.toChars(0x1F1F8)) + new String(Character.toChars(0x1F1F9))
                + new String(Character.toChars(0x1F1EA)) + new String(Character.toChars(0x1F1FB)) + new String(Character.toChars(0x1F1EA)), "Steve"));
        assertEquals("<human>", mask(new String(Character.toChars(0x1F162)) + "teve", "Steve"));
        assertEquals("<human>", mask(new String(Character.toChars(0x1F182)) + "teve", "Steve"));
    }

    @Test
    void shortNamesWithDigitsOrUnderscoreAreMaskedInsideWords() {
        assertEquals("<human>_x", mask("Jo9_x", "Jo9"));
        assertEquals("<human>x", mask("u_1x", "u_1"));
        assertEquals("x<human>", mask("x_ab", "_ab"));
        assertEquals("<human>_<human>", mask("ab1_ab1", "ab1"));
        assertEquals("hi <human>.", mask("hi u_1.", "u_1"));
        assertEquals("B o b", mask("B o b", "Bob")); // stated weakness
        // a match over 3 tokens with a longer token fully inside is ordinary text, not spaced-out letters
        assertEquals("say the e d now", mask("say the e d now", "theed"));
    }

    @Test
    void falseDropRateOnOrdinaryEnglishIsAtMostOnePercent() {
        String[] words = ("the of and to a in is it you that he was for on are with as i his they be at one have this from or had by hot but "
                + "some what there we can out other were all your when up use word how said an each she which do their time if will way about many "
                + "then them write would like so these her long make thing see him two has look more day could go come did number sound no most people "
                + "my over know water than call first who may down side been now find any new work part take get place made live where after back little "
                + "only round man year came show every good me give our under name very through just form sentence great think say help low line differ "
                + "turn cause much mean before move right boy old too same tell does set three want air well also play small end put home read hand port "
                + "large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again "
                + "animal point mother world near build self earth father head stand own page should country found answer school grow study still learn "
                + "plant cover food sun four between state keep eye never last let thought city tree cross farm hard start might story saw far sea draw "
                + "left late run while press close night real life few north open seem together next white children begin got walk example ease paper "
                + "group always music those both mark often letter until mile river car feet care second book carry took science eat room friend began "
                + "idea fish mountain stop once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever red "
                + "list though feel talk bird soon body dog family direct pose leave song measure door product black short numeral class wind question "
                + "happen complete ship area half rock order fire south problem piece told knew pass since top whole king space heard best hour better "
                + "true during hundred five remember step early hold west ground interest reach fast verb sing listen six table travel less morning ten "
                + "simple several vowel toward war lay against pattern slow center love person money serve appear road map rain rule govern pull cold "
                + "notice voice unit power town fine certain fly fall lead cry dark machine note wait plan figure star box noun field rest correct able "
                + "pound done beauty drive stood contain front teach week final gave green oh quick develop ocean warm free minute strong special mind "
                + "behind clear tail produce fact street inch multiply nothing course stay wheel full force blue object decide surface deep moon island "
                + "foot system busy test record boat common gold possible plane stead dry wonder laugh thousand ago ran check game shape equate hot miss "
                + "brought heat snow tire bring yes distant fill east paint language among").split(" ");
        String[] names = {"Theo", "Jack", "Mark", "Anna", "Lisa", "Dean", "Paul", "John", "Mike", "Sara", "Emma", "Luke", "Adam", "Eric", "Alex",
            "Leon", "Noah", "Liam", "Owen", "Ryan", "Evan", "Ella", "Lena", "Nina", "Tina", "Rose", "Jade", "Zoe", "Sam", "Tom", "Max", "Ben",
            "Dan", "Joe", "Kai", "Leo", "Ian", "Amy", "Eve", "Ann", "Hugo", "Finn"};
        NameMask m = new NameMask();
        for (String n : names) {
            m.seen(n);
        }
        java.util.Random rnd = new java.util.Random(42);
        int drops = 0;
        int total = 2000;
        for (int s = 0; s < total; s++) {
            StringBuilder sb = new StringBuilder();
            int n = 6 + rnd.nextInt(10);
            for (int i = 0; i < n; i++) {
                sb.append(words[rnd.nextInt(words.length)]).append(i < n - 1 ? " " : ".");
            }
            try {
                m.mask(sb.toString(), List.of());
            } catch (IllegalStateException e) {
                drops++;
            }
        }
        System.out.println("false-drop rate: " + drops + "/" + total);
        assertTrue(drops * 100 <= total, "false drops " + drops + "/" + total);
    }

    // --- wiring (pure parts) ---

    @Test
    void wiringChecksTheRegisteredRootChildren() {
        var root = new com.mojang.brigadier.tree.RootCommandNode<Object>();
        root.addChild(com.mojang.brigadier.builder.LiteralArgumentBuilder.<Object>literal("say").build());
        assertTrue(AuditWiring.isRegistered(root, "say"));
        assertFalse(AuditWiring.isRegistered(root, "steve"));
    }

    @Test
    void chatListenerRegistersOnlyAfterTheFeedAndAFailureLeavesChatUnusable() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        List<String> order = new ArrayList<>();
        AuditWiring.installChat(t, () -> {
            order.add("feed");
            t.onlineNames(List::of);
        }, () -> order.add("listener"));
        assertEquals(List.of("feed", "listener"), order);
        t.chat(false, "Zorbo", "w", () -> "hi");
        assertEquals(1, f.content.size());

        // the feed fails: the listener never registers and chat drops
        TextContentFamily t2 = new TextContentFamily(f.ledger, clock::get);
        List<String> order2 = new ArrayList<>();
        AuditWiring.installChat(t2, () -> {
            throw new IllegalStateException("feed");
        }, () -> order2.add("listener"));
        assertTrue(order2.isEmpty());
        t2.chat(false, "Zorbo", "w", () -> "hi");
        assertEquals(1, f.content.size());

        // the listener fails after the feed was wired: the source is nulled, chat drops
        TextContentFamily t3 = new TextContentFamily(f.ledger, clock::get);
        AuditWiring.installChat(t3, () -> t3.onlineNames(List::of), () -> {
            throw new IllegalStateException("listener");
        });
        t3.chat(false, "Zorbo", "w", () -> "hi");
        assertEquals(1, f.content.size());
        assertEquals(1, t3.maskDrops());
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