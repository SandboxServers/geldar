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
 * <p>Second pass (fail closed): the masked text is squashed (folded, every non-alphanumeric removed, agent ids and
 * placeholders replaced by a separator); if it still contains a known name of 4 or more characters (for example
 * {@code S t e v e}, {@code S.t.e.v.e}), {@link #mask} throws and the caller emits nothing. Words that merely squash
 * into a name are rare false drops. Throws on any failure: the caller must fail closed. Weaknesses: see the README.
 */
final class NameMask {
    static final int SEEN_MAX = 4096;
    static final int NAME_MAX = 32;
    static final int EMBED_MIN = 4;
    static final int SHORT_MAX = 3;
    static final int INPUT_MAX = 4096;
    static final String HUMAN = "<human>";
    static final String UUID = "<uuid>";
    private static final char SEP = '\u0001';
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|(?<![0-9a-zA-Z])[0-9a-fA-F]{32}(?![0-9a-zA-Z])");
    private static final Pattern AGENT_ID = Pattern.compile(
            "(?<![A-Za-z0-9_])ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}(?![A-Za-z0-9_])");
    /** Partial: common Cyrillic and Greek lookalikes (lower case) of Latin letters. */
    private static final Map<Character, Character> LOOKALIKE = Map.ofEntries(
            Map.entry('\u0430', 'a'), Map.entry('\u0435', 'e'), Map.entry('\u043e', 'o'), Map.entry('\u0440', 'p'),
            Map.entry('\u0441', 'c'), Map.entry('\u0443', 'y'), Map.entry('\u0445', 'x'), Map.entry('\u043a', 'k'),
            Map.entry('\u0456', 'i'), Map.entry('\u0455', 's'), Map.entry('\u0458', 'j'), Map.entry('\u04bb', 'h'),
            Map.entry('\u0501', 'd'), Map.entry('\u043c', 'm'), Map.entry('\u043d', 'h'), Map.entry('\u0442', 't'),
            Map.entry('\u0432', 'b'), Map.entry('\u0475', 'v'), Map.entry('\u04cf', 'l'), Map.entry('\u0131', 'i'),
            Map.entry('\u03b1', 'a'), Map.entry('\u03b5', 'e'), Map.entry('\u03bf', 'o'), Map.entry('\u03c1', 'p'),
            Map.entry('\u03bd', 'v'), Map.entry('\u03b9', 'i'), Map.entry('\u03ba', 'k'), Map.entry('\u03c4', 't'),
            Map.entry('\u03c5', 'u'), Map.entry('\u03c7', 'x'), Map.entry('\u03b2', 'b'), Map.entry('\u03b7', 'n'),
            Map.entry('\u03c9', 'w'), Map.entry('\u0261', 'g'));

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
        Matcher m = UUID_SHAPE.matcher(t);
        int last = 0;
        while (m.find()) {
            maskNames(t, last, m.start(), ns, out);
            out.append(UUID);
            last = m.end();
        }
        maskNames(t, last, t.length(), ns, out);
        String masked = out.toString();
        if (residual(masked, ns)) {
            throw new IllegalStateException("residual name after masking");
        }
        return masked;
    }

    /** The name sets for one call: every key, the 4+ keys' longest length, and the short keys by kind. */
    private static final class Names {
        final Set<String> all;
        final Set<String> shortLetters = new HashSet<>();
        final Set<String> shortOther = new HashSet<>();
        int maxLen;

        Names(Set<String> all) {
            this.all = all;
            for (String k : all) {
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

    /** The folded text with, per folded char, the original range it came from. */
    private static final class Folded {
        final char[] c;
        final int[] from;
        final int[] to;
        int n;

        Folded(int cap) {
            c = new char[cap * 3 + 3];
            from = new int[cap * 3 + 3];
            to = new int[cap * 3 + 3];
        }

        void add(char ch, int f, int t) {
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
            if (cp < 128) {
                out.add(Character.toLowerCase((char) cp), i, i + len);
            } else {
                String f = Normalizer.normalize(new String(Character.toChars(cp)), Normalizer.Form.NFKC)
                        .toLowerCase(Locale.ROOT);
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

    private static void foldOne(int cp, Folded out, int from, int to) {
        if (cp == 0xDF || cp == 0x1E9E) { // sharp s and capital sharp s fold to "ss"
            out.add('s', from, to);
            out.add('s', from, to);
            return;
        }
        int type = Character.getType(cp);
        if (type == Character.FORMAT || type == Character.NON_SPACING_MARK || type == Character.ENCLOSING_MARK
                || type == Character.COMBINING_SPACING_MARK) {
            return;
        }
        if (cp > 0xFFFF) {
            out.add('\u0000', from, to); // a delimiter: no supplementary letter is matchable
            return;
        }
        char ch = (char) cp;
        Character look = LOOKALIKE.get(ch);
        out.add(look != null ? look : ch, from, to);
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

    private static void maskNames(String text, int from, int to, Names ns, StringBuilder out) {
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
                out.append(HUMAN);
                pos = sp[1];
            }
        }
        out.append(text, pos, to);
    }

    private static void scanWord(Folded f, int ws, int we, Names ns, List<int[]> spans) {
        if (we - ws <= SHORT_MAX && ns.shortOther.contains(new String(f.c, ws, we - ws))) {
            add(spans, f, ws, we);
            return;
        }
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
            for (int len = Math.min(ns.maxLen, we - p); len >= EMBED_MIN; len--) {
                if (ns.all.contains(new String(f.c, p, len))) {
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

    /** The second pass: does the squashed masked text still hold a known name of 4 or more characters? */
    private static boolean residual(String masked, Names ns) {
        if (ns.maxLen < EMBED_MIN) {
            return false;
        }
        String cleaned = AGENT_ID.matcher(masked.replace(HUMAN, String.valueOf(SEP)).replace(UUID, String.valueOf(SEP)))
                .replaceAll(String.valueOf(SEP));
        Folded f = fold(cleaned, 0, cleaned.length());
        StringBuilder q = new StringBuilder(f.n);
        for (int i = 0; i < f.n; i++) {
            char c = f.c[i];
            if (Character.isLetterOrDigit(c) || c == SEP) {
                q.append(c);
            }
        }
        String s = q.toString();
        for (int p = 0; p < s.length(); p++) {
            for (int len = Math.min(ns.maxLen, s.length() - p); len >= EMBED_MIN; len--) {
                if (ns.all.contains(s.substring(p, p + len))) {
                    return true;
                }
            }
        }
        return false;
    }
}