package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.ids.LifeIds;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The human-chat name mask (owner direct, 2026-11-17, decision record 0375). Chat is exported verbatim except that
 * human player names become {@code <human>} and UUID-shaped strings become {@code <uuid>}. Names masked: the speaker,
 * every online player that is not a life id (both passed per call), and every human name seen since server start (a
 * bounded set of {@link #SEEN_MAX}, oldest evicted; fed from login and logout by the profile name only: the whitelist,
 * usercache and player data files are never read). An agent name ({@link LifeIds#isLifeId}) is never masked.
 *
 * <p>Input cap: the text is cut to {@link #INPUT_MAX} characters before any matching (vanilla chat is far shorter);
 * the tail is dropped, which also bounds the cost. Matching works on a folded copy of the text with an offset map back
 * to the original, so the original span is what is replaced: NFKC (fullwidth, circled and mathematical forms), full
 * lower-casing (Locale.ROOT, plus sharp s as "ss"), removal of format, nonspacing, enclosing and spacing-combining
 * marks (zero-width, soft hyphen, RTL and LTR marks, accents), and a PARTIAL map of Cyrillic and Greek lookalikes of
 * Latin letters. Rules: a name of 3 characters or fewer made of letters is masked as a whole run of letters
 * (underscore, digits and punctuation are delimiters, so {@code Bob_Smith} and {@code Bob2} mask {@code Bob}; a longer
 * word such as {@code Bobby} does not); a short name with a digit or underscore is masked as a whole word; a name of
 * 4 or more characters is also masked when embedded in a longer word (longest match first). Names with a character
 * other than a letter, digit or underscore after folding, and names longer than {@link #NAME_MAX}, are ignored.
 *
 * <p>Folding also strips every unassigned, private-use, noncharacter and unpaired-surrogate code point (they carry no
 * letter, so removing one cannot create a name; it neither splits nor joins), and applies the homoglyph map to the
 * exact (cased) code point before lower-casing. A supplementary-plane letter or digit is a foreign letter, as a BMP one is.
 *
 * <p>Second pass (fail closed): the masked text is squashed (folded, only letters and digits kept, an underscore and
 * a foreign letter are noise, agent ids are one separator); a known name is compared in the same form (letters and
 * digits only, underscore removed), so {@code Alex_77} is found in {@code A l e x 7 7}. The text is cut only at the
 * placeholders the mask itself inserted (recorded spans, never found by searching), so a {@code <human>}, {@code
 * <uuid>} or agent id typed by a human cannot split a name: a typed placeholder is noise. If the squashed text
 * still contains a known name of 4 or more characters (for example {@code S t e v e}, {@code S.t.e.v.e}),
 * {@link #mask} throws and the caller emits nothing. Words that merely squash into a name are rare false drops.
 * Throws on any failure: the caller must fail closed. Weaknesses: see the README.
 */
final class NameMask {
    static final int SEEN_MAX = 4096;
    static final int NAME_MAX = 32;
    static final int EMBED_MIN = 4;
    static final int SHORT_MAX = 3;
    static final int INPUT_MAX = 4096;
    static final String HUMAN = "<human>";
    static final String UUID = "<uuid>";
    private static final Pattern AGENT_ID = Pattern.compile("(?<![A-Za-z0-9_])ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}(?![A-Za-z0-9_])");
    /** A placeholder spelled by a human: in the second pass it is noise (neither splits nor joins), never a segment break. */
    private static final Pattern TYPED_PLACEHOLDER = Pattern.compile("<(?:human|uuid)>", Pattern.CASE_INSENSITIVE);
    /** Stands for a supplementary-plane letter or digit after folding: a foreign letter, like a BMP one. */
    private static final char FOREIGN = '\u00aa';
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|(?<![0-9a-zA-Z])[0-9a-fA-F]{32}(?![0-9a-zA-Z])");
    /** Lower-case lookalikes (the partial map): see {@link Lookalikes}. */
    static Map<Character, Character> lookalikes() {
        return Lookalikes.lower();
    }

    /** The direct (capital and caseless) lookalikes, by exact code point. */
    static Map<Integer, Character> capitalLookalikes() {
        return Lookalikes.direct();
    }

    /** The first code point of the three letter-block alphabets with no NFKD mapping: regional indicators, negative circled and squared. */
    private static int blockLetter(int cp) {
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
            return 'a' + (cp - 0x1F1E6);
        }
        if (cp >= 0x1F150 && cp <= 0x1F169) {
            return 'a' + (cp - 0x1F150);
        }
        if (cp >= 0x1F170 && cp <= 0x1F189) {
            return 'a' + (cp - 0x1F170);
        }
        return -1;
    }

    /** Default_Ignorable_Code_Point (explicit set) and control characters other than tab, newline and the other spaces. */
    static boolean invisible(int cp) {
        if (cp < 32) {
            return cp < 9 || cp > 13;
        }
        if (cp == 127 || (cp >= 0x80 && cp <= 0x9F && cp != 0x85)) {
            return true;
        }
        if (cp >= 0xFFF0 && cp <= 0xFFF8) {
            return true;
        }
        int type = Character.getType(cp);
        if (type == Character.UNASSIGNED || type == Character.PRIVATE_USE || type == Character.SURROGATE
                || (cp >= 0xFDD0 && cp <= 0xFDEF) || (cp & 0xFFFE) == 0xFFFE) {
            return true; // unassigned, private use, noncharacters, unpaired surrogates: no letter, stripped
        }
        return cp == 0xAD || cp == 0x34F || cp == 0x61C || (cp >= 0x115F && cp <= 0x1160) || (cp >= 0x17B4 && cp <= 0x17B5)
                || (cp >= 0x180B && cp <= 0x180F) || (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E)
                || (cp >= 0x2060 && cp <= 0x206F) || cp == 0x3164 || (cp >= 0xFE00 && cp <= 0xFE0F) || cp == 0xFEFF
                || cp == 0xFFA0 || (cp >= 0x1BCA0 && cp <= 0x1BCA3) || (cp >= 0x1D173 && cp <= 0x1D17A)
                || (cp >= 0xE0000 && cp <= 0xE0FFF);
    }

    private final int seenMax;
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();

    NameMask() {
        this(SEEN_MAX);
    }

    NameMask(int seenMax) {
        this.seenMax = seenMax;
    }

    /** Remembers a human name (a login or logout); a life id, null or unmatchable name is ignored. Oldest evicted. */
    synchronized void seen(String name) {
        String key = key(name);
        if (key == null) {
            return;
        }
        seen.remove(key); // a name seen again becomes the newest
        seen.add(key);
        while (seen.size() > seenMax) {
            Iterator<String> it = seen.iterator();
            it.next();
            it.remove();
        }
    }

    synchronized int seenSize() {
        return seen.size();
    }

    /** The masked text; throws when a residual name is found (fail closed). Null text is empty. */
    String mask(String text, Collection<String> names) {
        if (text == null || text.isEmpty()) {
            return "";
        }
        String t = text.length() > INPUT_MAX ? text.substring(0, INPUT_MAX) : text;
        Set<String> set;
        synchronized (this) {
            set = new HashSet<>(seen);
        }
        for (String n : names) {
            String k = key(n);
            if (k != null) {
                set.add(k);
            }
        }
        Names ns = new Names(set);
        StringBuilder out = new StringBuilder(t.length());
        List<int[]> marks = new ArrayList<>(); // where the MASK put a placeholder in the output; typed ones are not here
        Matcher m = UUID_SHAPE.matcher(t);
        int last = 0;
        while (m.find()) {
            maskNames(t, last, m.start(), ns, out, marks);
            marks.add(new int[] {out.length(), out.length() + UUID.length()});
            out.append(UUID);
            last = m.end();
        }
        maskNames(t, last, t.length(), ns, out, marks);
        String masked = out.toString();
        if (residual(masked, marks, ns)) {
            throw new IllegalStateException("residual name after masking");
        }
        return masked;
    }

    /** The name sets for one call: every key, the 4+ keys' longest length, and the short keys by kind. */
    private static final class Names {
        final Set<String> all;
        final Set<String> shortLetters = new HashSet<>();
        final Set<String> shortOther = new HashSet<>();
        /** The second pass keys: letters and digits only (underscore removed), 4 or more characters, ASCII. */
        final Set<String> squashed = new HashSet<>();
        int maxLen;
        int squashMax;

        Names(Set<String> all) {
            this.all = all;
            for (String k : all) {
                String sq = squashKey(k);
                if (sq != null) {
                    squashed.add(sq);
                    squashMax = Math.max(squashMax, sq.length());
                }
                if (k.length() >= EMBED_MIN) {
                    maxLen = Math.max(maxLen, k.length());
                } else if (k.chars().allMatch(Character::isLetter)) {
                    shortLetters.add(k);
                } else {
                    shortOther.add(k);
                }
            }
        }
    }

    /**
     * The key as the second pass sees text: normalised the same way as the squashed text (only ASCII letters and
     * digits; an underscore is removed, as it is in the text), or null if shorter than {@link #EMBED_MIN} or holding
     * a character the squashed text can never hold.
     */
    static String squashKey(String key) {
        StringBuilder sb = new StringBuilder(key.length());
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c == '_') {
                continue;
            }
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) {
                return null;
            }
            sb.append(c);
        }
        return sb.length() >= EMBED_MIN ? sb.toString() : null;
    }

    /** The folded text with, per folded char, the original range it came from. */
    private static final class Folded {
        char[] c;
        int[] from;
        int[] to;
        int n;

        Folded(int cap) {
            c = new char[cap + 16];
            from = new int[cap + 16];
            to = new int[cap + 16];
        }

        void add(char ch, int f, int t) {
            if (n == c.length) {
                c = java.util.Arrays.copyOf(c, n * 2);
                from = java.util.Arrays.copyOf(from, n * 2);
                to = java.util.Arrays.copyOf(to, n * 2);
            }
            c[n] = ch;
            from[n] = f;
            to[n++] = t;
        }
    }

    private static Folded fold(String s, int start, int end) {
        Folded out = new Folded(end - start);
        int i = start;
        while (i < end) {
            int cp = s.codePointAt(i);
            int len = Character.charCount(cp);
            if (cp >= 32 && cp < 127 || (cp >= 9 && cp <= 13)) {
                out.add(Character.toLowerCase((char) cp), i, i + len);
            } else if (invisible(cp)) {
                // stripped: it neither splits a name nor is matched
            } else if (blockLetter(cp) >= 0) {
                out.add((char) blockLetter(cp), i, i + len);
            } else if (Lookalikes.beforeNormalisation(cp) != 0) {
                out.add(Lookalikes.beforeNormalisation(cp), i, i + len);
            } else {
                String f = Normalizer.normalize(new String(Character.toChars(cp)), Normalizer.Form.NFKD);
                int j = 0;
                while (j < f.length()) {
                    int fc = f.codePointAt(j);
                    j += Character.charCount(fc);
                    foldOne(fc, out, i, i + len);
                }
            }
            i += len;
        }
        return out;
    }

    /** One code point of the NFKD form: the homoglyph map first, on the exact (cased) code point, then lower-casing. */
    private static void foldOne(int cp, Folded out, int from, int to) {
        char direct = Lookalikes.direct(cp);
        if (direct != 0) {
            out.add(direct, from, to);
            return;
        }
        if (cp < 128) {
            foldLower(Character.toLowerCase(cp), out, from, to);
            return;
        }
        String lower = new String(Character.toChars(cp)).toLowerCase(Locale.ROOT);
        int j = 0;
        while (j < lower.length()) {
            int lc = lower.codePointAt(j);
            j += Character.charCount(lc);
            foldLower(lc, out, from, to);
        }
    }

    private static void foldLower(int cp, Folded out, int from, int to) {
        if (cp == 0xDF || cp == 0x1E9E) { // sharp s and capital sharp s fold to "ss"
            out.add('s', from, to);
            out.add('s', from, to);
            return;
        }
        if (invisible(cp)) {
            return;
        }
        int bl = blockLetter(cp);
        if (bl >= 0) {
            out.add((char) bl, from, to);
            return;
        }
        int type = Character.getType(cp);
        if (type == Character.FORMAT || type == Character.NON_SPACING_MARK || type == Character.ENCLOSING_MARK
                || type == Character.COMBINING_SPACING_MARK) {
            return;
        }
        if (cp > 0xFFFF) {
            // a supplementary letter or digit is a foreign letter (noise inside a token, as a BMP one is); any other
            // supplementary character (emoji, symbol) is a delimiter
            out.add(Character.isLetterOrDigit(cp) ? FOREIGN : '\u0000', from, to);
            return;
        }
        char ch = (char) cp;
        char look = Lookalikes.lower(ch);
        out.add(look != 0 ? look : ch, from, to);
    }

    private static String key(String name) {
        if (name == null || name.isEmpty() || name.length() > NAME_MAX || LifeIds.isLifeId(name)) {
            return null;
        }
        Folded f = fold(name, 0, name.length());
        if (f.n == 0 || f.n > NAME_MAX) {
            return null;
        }
        for (int i = 0; i < f.n; i++) {
            if (!wordChar(f.c[i])) {
                return null;
            }
        }
        return new String(f.c, 0, f.n);
    }

    private static boolean wordChar(char c) {
        return c == '_' || Character.isLetterOrDigit(c);
    }

    private static void maskNames(String text, int from, int to, Names ns, StringBuilder out, List<int[]> marks) {
        if (from >= to) {
            return;
        }
        if (ns.all.isEmpty()) {
            out.append(text, from, to);
            return;
        }
        Folded f = fold(text, from, to);
        List<int[]> spans = new ArrayList<>(); // original [start, end)
        int i = 0;
        while (i < f.n) {
            if (!wordChar(f.c[i])) {
                i++;
                continue;
            }
            int ws = i;
            int we = i;
            while (we < f.n && wordChar(f.c[we])) {
                we++;
            }
            i = we;
            if (LifeIds.isLifeId(new String(f.c, ws, we - ws))) {
                continue;
            }
            scanWord(f, ws, we, ns, spans);
        }
        int pos = from;
        for (int[] sp : spans) {
            if (sp[0] > pos) {
                out.append(text, pos, sp[0]);
            }
            if (sp[1] > pos) {
                marks.add(new int[] {out.length(), out.length() + HUMAN.length()});
                out.append(HUMAN);
                pos = sp[1];
            }
        }
        out.append(text, pos, to);
    }

    private static void scanWord(Folded f, int ws, int we, Names ns, List<int[]> spans) {
        int p = ws;
        while (p < we) {
            if (Character.isLetter(f.c[p]) && (p == ws || !Character.isLetter(f.c[p - 1]))) {
                int le = p;
                while (le < we && Character.isLetter(f.c[le])) {
                    le++;
                }
                if (le - p <= SHORT_MAX && ns.shortLetters.contains(new String(f.c, p, le - p))) {
                    add(spans, f, p, le);
                    p = le;
                    continue;
                }
            }
            int hit = 0;
            // a short name with a digit or underscore (Jo9, u_1) is matched anywhere in the word, like a long one
            for (int len = Math.min(Math.max(ns.maxLen, SHORT_MAX), we - p); len >= 1; len--) {
                if (len >= EMBED_MIN ? ns.all.contains(new String(f.c, p, len)) : ns.shortOther.contains(new String(f.c, p, len))) {
                    hit = len;
                    break;
                }
            }
            if (hit > 0) {
                add(spans, f, p, p + hit);
                p += hit;
            } else {
                p++;
            }
        }
    }

    private static void add(List<int[]> spans, Folded f, int a, int b) {
        int start = f.from[a];
        int end = f.to[b - 1];
        if (!spans.isEmpty() && start < spans.get(spans.size() - 1)[1]) {
            int[] lastSpan = spans.get(spans.size() - 1);
            lastSpan[1] = Math.max(lastSpan[1], end);
            return;
        }
        spans.add(new int[] {start, end});
    }

    /**
     * The second pass: does the squashed masked text still hold a known name of 4 or more characters? The text is cut
     * into segments at placeholders and agent ids (out of band: no separator character is ever inserted). In a segment
     * only ASCII letters and digits are kept; a non-ASCII letter that survived folding is noise and neither splits nor
     * joins. A match is a leak, so the message is dropped, when it lies inside ONE source token (noise was removed
     * from it) or when it spans 3 or more tokens and every token fully inside it has at most 2 characters (letters
     * genuinely spaced out). A match over two tokens, or over ordinary longer words, is not dropped.
     */
    private static boolean residual(String masked, List<int[]> marks, Names ns) {
        if (ns.squashMax < EMBED_MIN) {
            return false;
        }
        int last = 0;
        for (int[] mark : marks) { // only the placeholders the mask itself inserted cut the text
            if (residualSegment(masked.substring(last, mark[0]), ns)) {
                return true;
            }
            last = mark[1];
        }
        return residualSegment(masked.substring(last), ns);
    }

    private static boolean residualSegment(String raw, Names ns) {
        // an agent id is one delimiter (its own letters never join a name); a placeholder typed by a human is noise
        String segment = TYPED_PLACEHOLDER.matcher(AGENT_ID.matcher(raw).replaceAll(" ")).replaceAll("");
        Folded f = fold(segment, 0, segment.length());
        // an underscore is read both ways: as noise inside a token (A_l_e_x, Alex_77 with a foreign letter) and as a delimiter (S_t_e-v-e)
        return squashScan(f, ns, true) || squashScan(f, ns, false);
    }

    private static boolean squashScan(Folded f, Names ns, boolean underscoreIsNoise) {
        StringBuilder q = new StringBuilder(f.n);
        int[] tok = new int[f.n + 1];
        int token = 0;
        boolean inToken = false;
        for (int i = 0; i < f.n; i++) {
            char c = f.c[i];
            boolean ascii = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
            if (ascii) {
                if (!inToken) {
                    token++;
                    inToken = true;
                }
                tok[q.length()] = token;
                q.append(c);
            } else if (!((underscoreIsNoise && c == '_') || (c > 127 && Character.isLetterOrDigit(c)))) {
                inToken = false; // a delimiter ends the token; a foreign letter (and, in one reading, an underscore) is noise inside it
            }
        }
        String s = q.toString();
        int[] tokFirst = new int[token + 2];
        int[] tokLast = new int[token + 2];
        java.util.Arrays.fill(tokFirst, Integer.MAX_VALUE);
        for (int i = 0; i < s.length(); i++) {
            tokFirst[tok[i]] = Math.min(tokFirst[tok[i]], i);
            tokLast[tok[i]] = i;
        }
        for (int p = 0; p < s.length(); p++) {
            for (int len = Math.min(ns.squashMax, s.length() - p); len >= EMBED_MIN; len--) {
                if (ns.squashed.contains(s.substring(p, p + len)) && spacedOut(tok, tokFirst, tokLast, p, p + len)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean spacedOut(int[] tok, int[] tokFirst, int[] tokLast, int a, int b) {
        int first = tok[a];
        int lastTok = tok[b - 1];
        if (first == lastTok) {
            return true; // inside one token: only noise characters were removed
        }
        if (lastTok - first + 1 < 3) {
            return false;
        }
        for (int k = first; k <= lastTok; k++) {
            boolean fullyInside = tokFirst[k] >= a && tokLast[k] < b;
            if (fullyInside && tokLast[k] - tokFirst[k] + 1 > 2) {
                return false;
            }
        }
        return true;
    }
}
