package dev.geldar.ledger.neoforge.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.jupiter.api.Test;

/** The leaks found by the third fuzz review of the human-chat name mask: each test fails on the code before its fix. */
class NameMaskLeakFixTest {
    private static String mask(String text, String... names) {
        return new NameMask().mask(text, Arrays.asList(names));
    }

    /** The text is either dropped (the mask throws) or the name is gone: both are safe, a survivor is a leak. */
    private static void maskedOrDropped(String text, String name) {
        String out;
        try {
            out = mask("hey " + text + " ok", name);
        } catch (IllegalStateException dropped) {
            return;
        }
        assertEquals("hey <human> ok", out, "exported with the name: " + text);
    }

    private static String cp(int c) {
        return new String(Character.toChars(c));
    }

    @Test
    void namesWithUnderscoreOrDigitsAreFoundBySpacedAndNoisyForms() {
        String[] alex = {"A l e x _ 7 7", "A l e x 7 7", "A.l.e.x._.7.7", "A-l-e-x-_-7-7", "A l ex_77", "a_l_e-x-7_7","A\u0ce6lex_77",
            "A\ud83d\ude00l\ud83d\ude00e\ud83d\ude00x\ud83d\ude00_\ud83d\ude00" + "7\ud83d\ude007", "A_l_e_x___7_7"};
        for (String t : alex) {
            maskedOrDropped(t, "Alex_77");
        }
        for (String t : new String[] {"J o 9 _ x", "Jo9\u0ce6_x", "J o 9 x", "J_o_9_x", "Jo9\u200b_\u200bx"}) {
            maskedOrDropped(t, "Jo9_x");
        }
        assertThrows(IllegalStateException.class, () -> mask("hey A l e x _ 7 7 ok", "Alex_77"));
        assertThrows(IllegalStateException.class, () -> mask("hey J o 9 _ x ok", "Jo9_x"));
        assertThrows(IllegalStateException.class, () -> mask("hey A\u0ce6lex_77 ok", "Alex_77"));
        // the plain forms stay masked, and the squash key drops the underscore
        assertEquals("hey <human> ok", mask("hey Alex_77 ok", "Alex_77"));
        assertEquals("alex77", NameMask.squashKey("alex_77"));
        assertEquals("jo9x", NameMask.squashKey("jo9_x"));
        assertEquals(null, NameMask.squashKey("mr_x")); // 3 characters: the short-token rule stays
        assertEquals(null, NameMask.squashKey("ab_c\u00aa"));
    }

    @Test
    void invisibleUnassignedPrivateUseNoncharacterAndLoneSurrogateDoNotSplitAName() {
        String[] fillers = {"\ufff0", "\ufff8", "\ufff4", "\ue000", "\uf8ff", "\ufdd0", "\ufdef", "\uffff", "\ufffe", "\ud800", "\udfff",
            cp(0x10FFFD), cp(0x10FFFF), cp(0xF0000), cp(0x1FFFE), "\u0378", "\ud83d", cp(0x3FFFD)};
        for (String filler : fillers) {
            assertEquals("<human>", mask("Ste" + filler + "ve", "Steve"), "U+" + Integer.toHexString(filler.codePointAt(0)));
            assertEquals("a <human> b", mask("a Ste" + filler + filler + "ve b", "Steve"), "U+" + Integer.toHexString(filler.codePointAt(0)));
        }
        assertTrue(NameMask.invisible(0xFFF0) && NameMask.invisible(0xFFF8) && NameMask.invisible(0xFDD0) && NameMask.invisible(0xD800));
        assertTrue(NameMask.invisible(0xE000) && NameMask.invisible(0x10FFFF) && NameMask.invisible(0x378));
        assertFalse(NameMask.invisible('a') || NameMask.invisible(0xFFFD) || NameMask.invisible(0x20AC) || NameMask.invisible(0x1F600));
    }

    @Test
    void placeholdersAndAgentIdsTypedByAHumanCannotSplitAName() {
        String[] typed = {"Ste<human>ve", "Ste<uuid>ve", "S<human>t<human>e<human>v<human>e", "S<uuid>t<uuid>e<uuid>v<uuid>e", "Ste<HUMAN>ve",
            "S ag_x_99 t ag_x_99 e ag_x_99 v ag_x_99 e", "S ag_x_99 t e v e", "<human>Ste<human>ve<human>", "St<human><uuid>eve"};
        for (String t : typed) {
            assertThrows(IllegalStateException.class, () -> mask("hey " + t + " ok", "Steve"), t);
        }
        // a name inside the typed id text is not exported either
        assertEquals("ag_<human><human>_12", mask("ag_<human>steve_12", "Steve")); // the name is masked, the typed text is plain
        // a genuine agent id stays an ordinary separator, and a typed placeholder alone is harmless text
        assertEquals("hi ag_steve_02 and ag_ada_01", mask("hi ag_steve_02 and ag_ada_01", "Steve", "ada1"));
        assertEquals("a <human> b <uuid>", mask("a <human> b <uuid>", "Steve"));
        // a real replaced span still cuts the text: other humans' names do not glue the neighbours together
        assertEquals("ab <human> cd", mask("ab Zorbo cd", "Zorbo"));
        assertEquals("Ste <human> ve", mask("Ste Zorbo ve", "Steve", "Zorbo"));
    }

    private static final String GREEK_CAPITALS = "\u0391A\u0392B\u0395E\u0396Z\u0397H\u0399I\u039aK\u039cM\u039dN\u039fO\u03a1P\u03a4T\u03a5Y\u03a7X\u03f9C";
    private static final String CYRILLIC_CAPITALS = "\u0405S\u0406I\u0408J\u0410A\u0412B\u0415E\u0417Z\u041aK\u041cM\u041dH\u041eO\u0420P\u0421C\u0422T"
            + "\u0423Y\u0425X\u042cB\u0404E\u0460W\u0474V\u04aeY\u04baH\u04c0L\u0500D\u051aQ\u051cW";

    @Test
    void everyGreekAndCyrillicCapitalMapsToItsLatinLookalike() {
        Map<Integer, Character> expected = new HashMap<>();
        for (String table : new String[] {GREEK_CAPITALS, CYRILLIC_CAPITALS}) {
            for (int i = 0; i < table.length(); i += 2) {
                expected.put((int) table.charAt(i), Character.toLowerCase(table.charAt(i + 1)));
            }
        }
        Map<Integer, Character> actual = NameMask.capitalLookalikes();
        for (var e : expected.entrySet()) {
            assertEquals(e.getValue(), actual.get(e.getKey()), "U+" + Integer.toHexString(e.getKey()));
            String name = "qq" + e.getValue() + "qq";
            assertEquals("<human>", mask("qq" + cp(e.getKey()) + "qq", name), "capital U+" + Integer.toHexString(e.getKey()));
            int lower = Character.toLowerCase(e.getKey());
            if (lower != e.getKey() && !NameMask.lookalikes().containsKey((char) lower)) { // eta, mu, nu, upsilon keep their own small forms
                assertEquals("<human>", mask("qq" + cp(lower) + "qq", name), "small form U+" + Integer.toHexString(lower));
            }
        }
        // nothing that is a Greek or Cyrillic capital sits in the map without an expectation
        for (int c : actual.keySet()) {
            boolean greekOrCyrillic = (c >= 0x370 && c <= 0x3FF) || (c >= 0x400 && c <= 0x52F);
            if (greekOrCyrillic && Character.isUpperCase(c)) {
                assertTrue(expected.containsKey(c), "unexpected capital U+" + Integer.toHexString(c));
            }
        }
        // the review's repros: the capital used to fold through its small form (Eta to n, Mu to u, Nu to v, Upsilon to u)
        assertEquals("<human>", mask("\u0397enry", "Henry"));
        assertEquals("<human>", mask("\u039cax", "Max"));
        assertEquals("<human>", mask("\u039dick", "Nick"));
        assertEquals("<human>", mask("\u03a5uri", "Yuri"));
        assertEquals("<human>", mask("\u03f9ool", "Cool"));
        assertEquals("<human>", mask("Zy\u0397ndo", "Zyhndo"));
        // small forms that were already mapped keep their letter (eta is n, mu is u)
        assertEquals("<human>", mask("\u03b7ick", "nick"));
        assertEquals("<human>", mask("\u03bcser", "user"));
    }

    @Test
    void lisuCherokeeCopticAndTheReviewsExtraLookalikesAreMasked() {
        assertEquals("<human>", mask("\ua4e2\ua4d4\ua4f0\ua4a6\ua4f0", "Steve")); // Lisu
        assertEquals("<human>", mask("\u13da\u13a2\u13ac\u13d9\u13ac", "Steve")); // Cherokee
        assertEquals("<human>", mask(cp(Character.toLowerCase(0x13da)) + "\u13a2\u13ac\u13d9\u13ac", "Steve")); // small Cherokee S
        assertEquals("<human>", mask("\u2ca4\u2ca6\u2c88\u2ca8\u2c88", "cteye")); // Coptic
        assertEquals("<human>", mask("St\u0454ve", "Steve")); // small Ukrainian ie
        assertEquals("<human>", mask("\u03f3im", "jim")); // yot
        assertEquals("<human>", mask("\u212emma", "emma"));
        assertEquals("<human>", mask("\u2573ena", "xena"));
        assertEquals("<human>", mask("\u222aser", "user"));
    }

    @Test
    void supplementaryPlaneLettersInsideANameAreNoiseLikeBmpOnes() {
        for (String letter : new String[] {cp(0x10000), cp(0x20000), cp(0x1E900), cp(0x10400), cp(0x13000)}) {
            maskedOrDropped("Ste" + letter + "ve", "Steve");
        }
        assertThrows(IllegalStateException.class, () -> mask("Ste\ud800\udc00ve", "Steve"));
        assertThrows(IllegalStateException.class, () -> mask("Ste" + cp(0x20000) + "ve", "Steve"));
        // the BMP behaviour is the same, and an emoji is still a delimiter (a 2-token split is a stated weakness)
        assertThrows(IllegalStateException.class, () -> mask("Ste\u0ce6ve", "Steve"));
        assertEquals("Ste\ud83d\ude00ve", mask("Ste\ud83d\ude00ve", "Steve"));
    }

    // ---- the permanent bounded fuzz ----

    private static final String[] NAMES = {"Steve", "Alex_77", "Jo9_x"};
    private static final String[] KEYS = {"steve", "alex77", "jo9x"};
    /** Oracle only: every substitute the generator can use, back to its Latin letter (independent of the mask's map). */
    private static final Map<Integer, Character> BACK = new HashMap<>();
    private static final Map<Character, int[]> SUBSTITUTES = new HashMap<>();

    static {
        for (String table : new String[] {GREEK_CAPITALS, CYRILLIC_CAPITALS}) {
            for (int i = 0; i < table.length(); i += 2) {
                addSubstitute(table.charAt(i + 1), table.charAt(i));
            }
        }
        String small = "\u0430a\u0435e\u043eo\u0440p\u0441c\u0445x\u0456i\u0458j\u0455s\u03bfo\u03b1a\u03b9i";
        for (int i = 0; i < small.length(); i += 2) {
            addSubstitute(small.charAt(i + 1), small.charAt(i));
        }
    }

    private static void addSubstitute(char latin, int code) {
        char lower = Character.toLowerCase(latin);
        BACK.put(code, lower);
        SUBSTITUTES.merge(lower, new int[] {code}, (a, b) -> {
            int[] r = Arrays.copyOf(a, a.length + 1);
            r[a.length] = b[0];
            return r;
        });
    }

    private static final String[] NOISE = {"", "", "\u200b", "\u0301", "\ufff0", "\ue000", "\ufdd0", "\ud800", "\u0ce6", "\ud800\udc00",
        "<human>", "<UUID>", "\u00ad", "\u0001", "\u2062", "\u0436", cp(0x10FFFD), cp(0x1E900), "\u0378", "\ufffe", "\u202e", "\u0300\u0301"};
    private static final String[] SEPARATORS = {" ", ".", "-", "_", "  ", "\n", "\t", "\u00a0", "\u3000", "\ud83d\ude00", "..", ",", " ag_x_99 ", "|", "*"};

    private static String variant(String name, Random rnd) {
        boolean spaced = rnd.nextBoolean(); // all gaps separated, or no gap separated: the two forms the pass is documented to catch
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            int[] subs = SUBSTITUTES.get(Character.toLowerCase(c));
            int r = rnd.nextInt(6);
            if (subs != null && r == 0) {
                sb.appendCodePoint(subs[rnd.nextInt(subs.length)]);
            } else if (Character.isLetter(c) && r == 1) {
                sb.append((char) (0xFF41 + Character.toLowerCase(c) - 'a')); // fullwidth
            } else if (Character.isLetter(c) && r == 2) {
                sb.appendCodePoint(0x1D41A + Character.toLowerCase(c) - 'a'); // mathematical bold
            } else {
                sb.append(rnd.nextBoolean() ? Character.toUpperCase(c) : Character.toLowerCase(c));
            }
            if (i < name.length() - 1) {
                if (spaced) {
                    sb.append(SEPARATORS[rnd.nextInt(SEPARATORS.length)]);
                }
                for (int k = rnd.nextInt(3); k > 0; k--) {
                    sb.append(NOISE[rnd.nextInt(NOISE.length)]);
                }
            }
        }
        return sb.toString();
    }

    private static String reduce(String exported) {
        String s = exported.replaceAll("(?i)<human>|<uuid>", "");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int c = s.codePointAt(i);
            i += Character.charCount(c);
            Character latin = BACK.get(c);
            String f = latin != null ? latin.toString() : Normalizer.normalize(cp(c), Normalizer.Form.NFKD).toLowerCase();
            for (char x : f.toCharArray()) {
                if ((x >= 'a' && x <= 'z') || (x >= '0' && x <= '9')) {
                    sb.append(x);
                }
            }
        }
        return sb.toString();
    }

    @Test
    void fixedSeedFuzzOfThreeNamesNeverExportsAName() {
        NameMask m = new NameMask();
        List<String> names = Arrays.asList(NAMES);
        Random rnd = new Random(0x600DL);
        int dropped = 0;
        int masked = 0;
        List<String> leaks = new ArrayList<>();
        long t0 = System.nanoTime();
        for (int n = 0; n < 20_000; n++) {
            String name = NAMES[rnd.nextInt(NAMES.length)];
            String v = variant(name, rnd);
            String text = "hey " + v + " ok";
            String out;
            try {
                out = m.mask(text, names);
            } catch (IllegalStateException e) {
                dropped++;
                continue;
            }
            masked++;
            String r = reduce(out);
            for (String any : NAMES) {
                if (r.contains(KEYS[Arrays.asList(NAMES).indexOf(any)])) {
                    leaks.add(any + " <= " + text.codePoints().mapToObj(c -> c < 127 && c > 31 ? String.valueOf((char) c) : "\\u{" + Integer.toHexString(c) + "}")
                            .reduce("", String::concat) + " => " + out);
                }
            }
        }
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertTrue(leaks.isEmpty(), leaks.size() + " leaks, first: " + leaks.subList(0, Math.min(5, leaks.size())));
        assertTrue(dropped > 1000 && masked > 1000, "dropped " + dropped + " masked " + masked + " (the test must exercise both)");
        assertTrue(ms < 3000, "20000 variants took " + ms + " ms");
        assertNotEquals(0, ms);
    }
}
