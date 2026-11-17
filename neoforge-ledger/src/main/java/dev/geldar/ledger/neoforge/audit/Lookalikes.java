package dev.geldar.ledger.neoforge.audit;

import java.util.HashMap;
import java.util.Map;

/**
 * The PARTIAL homoglyph map of the name mask: characters that look like a Latin letter. Three tables, applied in this
 * order to a code point after NFKD: DIRECT (exact code point, before any lower-casing, so a capital that looks like a
 * different letter than its small form is right: Greek capital Eta is h, small eta is n), then the lower-case table.
 * Every direct entry that has a lower-case form also registers that form (DERIVED) unless the lower table has it.
 * Coverage is partial: Lisu, Cherokee and Coptic only for the letters listed, and many alphabets are not mapped.
 */
final class Lookalikes {
    /** Lower-case Cyrillic, Greek, Armenian, small-cap and a few Latin lookalikes of Latin letters. */
    private static final Map<Character, Character> LOWER = Map.ofEntries(
            Map.entry('\u0430', 'a'), Map.entry('\u0435', 'e'), Map.entry('\u043e', 'o'), Map.entry('\u0440', 'p'),
            Map.entry('\u0441', 'c'), Map.entry('\u0443', 'y'), Map.entry('\u0445', 'x'), Map.entry('\u043a', 'k'),
            Map.entry('\u0456', 'i'), Map.entry('\u0455', 's'), Map.entry('\u0458', 'j'), Map.entry('\u04bb', 'h'),
            Map.entry('\u0501', 'd'), Map.entry('\u043c', 'm'), Map.entry('\u043d', 'h'), Map.entry('\u0442', 't'),
            Map.entry('\u0432', 'b'), Map.entry('\u0475', 'v'), Map.entry('\u04cf', 'l'), Map.entry('\u0131', 'i'),
            Map.entry('\u03b1', 'a'), Map.entry('\u03b5', 'e'), Map.entry('\u03bf', 'o'), Map.entry('\u03c1', 'p'),
            Map.entry('\u03bd', 'v'), Map.entry('\u03b9', 'i'), Map.entry('\u03ba', 'k'), Map.entry('\u03c4', 't'),
            Map.entry('\u03c5', 'u'), Map.entry('\u03c7', 'x'), Map.entry('\u03b2', 'b'), Map.entry('\u03b7', 'n'),
            Map.entry('\u03c9', 'w'), Map.entry('\u0261', 'g'),
            Map.entry('\u0251', 'a'), Map.entry('\u1d00', 'a'), Map.entry('\u0299', 'b'), Map.entry('\u1d04', 'c'),
            Map.entry('\u1d05', 'd'), Map.entry('\u1d07', 'e'), Map.entry('\ua730', 'f'), Map.entry('\u0262', 'g'),
            Map.entry('\u029c', 'h'), Map.entry('\u026a', 'i'), Map.entry('\u1d0a', 'j'), Map.entry('\u1d0b', 'k'),
            Map.entry('\u029f', 'l'), Map.entry('\u1d0d', 'm'), Map.entry('\u0274', 'n'), Map.entry('\u1d0f', 'o'),
            Map.entry('\u1d18', 'p'), Map.entry('\u0280', 'r'), Map.entry('\ua731', 's'), Map.entry('\u1d1b', 't'),
            Map.entry('\u1d1c', 'u'), Map.entry('\u1d20', 'v'), Map.entry('\u1d21', 'w'), Map.entry('\u1d22', 'z'),
            Map.entry('\u051b', 'q'), Map.entry('\u051d', 'w'), Map.entry('\u0433', 'r'), Map.entry('\u043f', 'n'),
            Map.entry('\u0437', 'z'), Map.entry('\u0448', 'w'), Map.entry('\u03b3', 'y'), Map.entry('\u03bc', 'u'),
            Map.entry('\u03b6', 'z'), Map.entry('\u057d', 'u'), Map.entry('\u0585', 'o'), Map.entry('\u0570', 'h'),
            Map.entry('\u0578', 'n'), Map.entry('\u0576', 'n'), Map.entry('\u0581', 'g'), Map.entry('\u0282', 's'),
            Map.entry('\u028b', 'u'), Map.entry('\u028f', 'y'), Map.entry('\u0290', 'z'), Map.entry('\u0225', 'z'),
            Map.entry('\u027c', 'r'), Map.entry('\u03c2', 'c'), Map.entry('\u0253', 'b'), Map.entry('\u0257', 'd'),
            Map.entry('\u00f8', 'o'), Map.entry('\u0192', 'f'), Map.entry('\u03dd', 'f'), Map.entry('\u01c0', 'l'));

    /** Pairs of (code point, Latin letter): capitals and caseless lookalikes, matched on the exact code point. */
    private static final String DIRECT_TABLE =
            // Greek capitals: A B E Z H I K M N O P T Y X, lunate sigma C
            "\u0391a\u0392b\u0395e\u0396z\u0397h\u0399i\u039Ak\u039Cm\u039Dn\u039Fo\u03A1p\u03A4t\u03A5y\u03A7x\u03F9c"
            // Greek without a capital pairing: pi n, lambda y, phi q, yot j
            + "\u03C0n\u03BBy\u03C6q\u03F3j"
            // Cyrillic capitals: S I J A B E Z K M H O P C T Y X, soft sign b, Ukrainian Ie, Omega, Izhitsa v, Y with stroke, Ha, palochka l, Komi De, Qa, We
            + "\u0405s\u0406i\u0408j\u0410a\u0412b\u0415e\u0417z\u041Ak\u041Cm\u041Dh\u041Eo\u0420p\u0421c\u0422t\u0423y\u0425x"
            + "\u042Cb\u0404e\u0460w\u0474v\u04AEy\u04BAh\u04C0l\u0500d\u051Aq\u051Cw"
            // Cherokee capitals (D R T A J E W M H G Z I R V S L C P K B)
            + "\u13A0d\u13A1r\u13A2t\u13AAa\u13ABj\u13ACe\u13B3w\u13B7m\u13BBh\u13C0g\u13C3z\u13C6i\u13D2r\u13D9v\u13DAs\u13DEl\u13DFc\u13E2p\u13E6k\u13F4b"
            // Lisu letters and one Yi radical
            + "\uA4D0b\uA4D1p\uA4D3d\uA4D4t\uA4D6g\uA4D7k\uA4D9j\uA4DAc\uA4DCz\uA4DDf\uA4DFm\uA4E0n\uA4E1l\uA4E2s\uA4E3r\uA4E6v\uA4E7h"
            + "\uA4EAw\uA4EBx\uA4ECy\uA4EEa\uA4F0e\uA4F2i\uA4F3o\uA4F4u\uA4A6v"
            // Coptic capitals, Canadian syllabics U, Tifinagh O, and a few Latin and symbol lookalikes
            + "\u2C80a\u2C82b\u2C88e\u2C8Cz\u2C8Eh\u2C92i\u2C94k\u2C98m\u2C9An\u2C9Eo\u2CA2p\u2CA4c\u2CA6t\u2CA8y\u2CACx"
            + "\u144Cu\u2D54o\u0184b\uA792c\u1D83g\u212Ee\u2573x\u222Au\u0D20o";

    private static final Map<Integer, Character> DIRECT = new HashMap<>();
    private static final Map<Character, Character> DERIVED = new HashMap<>();

    static {
        for (int i = 0; i + 1 < DIRECT_TABLE.length(); i += 2) {
            int cp = DIRECT_TABLE.charAt(i);
            char latin = DIRECT_TABLE.charAt(i + 1);
            DIRECT.put(cp, latin);
            char lower = Character.toLowerCase((char) cp);
            if (lower != cp && !LOWER.containsKey(lower)) {
                DERIVED.putIfAbsent(lower, latin);
            }
        }
    }

    private Lookalikes() {
    }

    /** The lower-case table (one entry per small lookalike). */
    static Map<Character, Character> lower() {
        return LOWER;
    }

    /** The direct table: capitals and caseless lookalikes, by exact code point. */
    static Map<Integer, Character> direct() {
        return DIRECT;
    }

    /** The Latin letter for an exact (not yet lower-cased) code point, or 0. */
    static char direct(int cp) {
        Character c = DIRECT.get(cp);
        return c == null ? 0 : c;
    }

    /**
     * The Latin letter for a code point BEFORE normalisation: the direct entry, or the small form derived from one.
     * Needed because NFKD would first turn some of them into another letter (lunate sigma U+03F9 and U+03F2 into Sigma
     * and sigma) before the map could see them.
     */
    static char beforeNormalisation(int cp) {
        char c = direct(cp);
        if (c == 0 && cp <= 0xFFFF) {
            Character d = DERIVED.get((char) cp);
            c = d == null ? 0 : d;
        }
        return c;
    }

    /** The Latin letter for a lower-case BMP character, or 0. */
    static char lower(char ch) {
        Character c = LOWER.get(ch);
        if (c == null) {
            c = DERIVED.get(ch);
        }
        return c == null ? 0 : c;
    }
}