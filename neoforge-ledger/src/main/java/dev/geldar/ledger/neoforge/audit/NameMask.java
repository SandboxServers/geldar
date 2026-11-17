package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.ids.LifeIds;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The human-chat name mask (owner direct, 2026-11-17, decision record 0375). Chat is exported verbatim except that
 * human player names become {@code <human>} and UUID-shaped strings become {@code <uuid>}. Names masked: the speaker,
 * every online player that is not a life id (both passed per call), and every human name seen since server start (a
 * bounded set of {@link #SEEN_MAX}, oldest evicted; fed from login and logout by the profile name only: the whitelist,
 * usercache and player data files are never read). An agent name ({@link LifeIds#isLifeId}) is never masked, as a name
 * to mask or as a token of the text. Matching is case-insensitive over runs of letters, digits and underscore:
 * a name of 3 characters or fewer is masked only as a whole token; a name of 4 or more characters is also masked when
 * embedded in a longer word (longest match first, left to right). Names with a character outside letters, digits and
 * underscore, and names longer than {@link #NAME_MAX} characters, are not matchable and are ignored. Throws on any
 * failure: the caller must fail closed (emit nothing). Weaknesses are stated in the README.
 */
final class NameMask {
    static final int SEEN_MAX = 4096;
    static final int NAME_MAX = 32;
    static final int EMBED_MIN = 4;
    static final String HUMAN = "<human>";
    static final String UUID = "<uuid>";
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|(?<![0-9a-zA-Z])[0-9a-fA-F]{32}(?![0-9a-zA-Z])");

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

    /** The masked text. {@code names} are the speaker and the online players for this message. Null text is empty. */
    String mask(String text, Collection<String> names) {
        if (text == null || text.isEmpty()) {
            return "";
        }
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
        int maxLen = 0;
        for (String k : set) {
            maxLen = Math.max(maxLen, k.length());
        }
        StringBuilder out = new StringBuilder(text.length());
        Matcher m = UUID_SHAPE.matcher(text);
        int last = 0;
        while (m.find()) {
            maskNames(text, last, m.start(), set, maxLen, out);
            out.append(UUID);
            last = m.end();
        }
        maskNames(text, last, text.length(), set, maxLen, out);
        return out.toString();
    }

    private static String key(String name) {
        if (name == null || name.isEmpty() || name.length() > NAME_MAX || LifeIds.isLifeId(name)) {
            return null;
        }
        for (int i = 0; i < name.length(); i++) {
            if (!wordChar(name.charAt(i))) {
                return null;
            }
        }
        return lower(name);
    }

    private static boolean wordChar(char c) {
        return c == '_' || Character.isLetterOrDigit(c);
    }

    /** Per-character lower-casing, so indices never shift. */
    private static String lower(String s) {
        char[] a = s.toCharArray();
        for (int i = 0; i < a.length; i++) {
            a[i] = Character.toLowerCase(a[i]);
        }
        return new String(a);
    }

    private static void maskNames(String text, int from, int to, Set<String> names, int maxLen, StringBuilder out) {
        int i = from;
        while (i < to) {
            if (!wordChar(text.charAt(i))) {
                out.append(text.charAt(i++));
                continue;
            }
            int end = i;
            while (end < to && wordChar(text.charAt(end))) {
                end++;
            }
            maskWord(text.substring(i, end), names, maxLen, out);
            i = end;
        }
    }

    private static void maskWord(String word, Set<String> names, int maxLen, StringBuilder out) {
        if (names.isEmpty() || LifeIds.isLifeId(word)) {
            out.append(word);
            return;
        }
        String low = lower(word);
        if (names.contains(low)) {
            out.append(HUMAN);
            return;
        }
        int n = low.length();
        int i = 0;
        while (i < n) {
            int hit = 0;
            for (int len = Math.min(maxLen, n - i); len >= EMBED_MIN; len--) {
                if (names.contains(low.substring(i, i + len))) {
                    hit = len;
                    break;
                }
            }
            if (hit > 0) {
                out.append(HUMAN);
                i += hit;
            } else {
                out.append(word.charAt(i++));
            }
        }
    }
}