package dev.geldar.ledger.core;

/**
 * A command-line flag whose value follows after whitespace: {@code --password VALUE} (also passwd, token, secret,
 * api-key, apikey, any case) and curl's lower-case {@code -u} / {@code --user} with {@code name:secret}. The head
 * must be followed by a space or tab, so {@code --password-file /x}, {@code --secret-name abc} and
 * {@code --token=...} (the key=value rule) do not match. Heads are run starts and each value is read once: linear.
 */
final class FlagScrub {
    private static final String R = Redactor.REDACTED;
    private static final String[] NAMES = {"password", "passwd", "token", "secret", "api-key", "apikey"};
    private static final int MAX_GAP = 64;
    private static final String TRAILING = ",;.)}]";

    private FlagScrub() {}

    static String scrub(String s) {
        int n = s.length();
        Scan.Splice sp = new Scan.Splice(s);
        int i = s.indexOf('-');
        while (i >= 0) {
            if (i > 0 && Scan.keyChar(s.charAt(i - 1))) {
                i = s.indexOf('-', i + 1);
                continue;
            }
            int headEnd = headEnd(s, i);
            if (headEnd < 0) {
                i = s.indexOf('-', i + 1);
                continue;
            }
            boolean user = s.charAt(i + 1) == 'u' || s.startsWith("--user", i);
            int at = headEnd;
            int gapEnd = at + MAX_GAP;
            while (at < n && at < gapEnd && Scan.blank(s.charAt(at))) {
                at++;
            }
            int end = hide(s, at, user, sp);
            i = s.indexOf('-', Math.max(end, headEnd));
        }
        return sp.finish();
    }

    /** End of a flag head at {@code i} followed by a blank, or -1. */
    private static int headEnd(String s, int i) {
        int n = s.length();
        int end = -1;
        if (s.startsWith("--", i)) {
            for (String name : NAMES) {
                if (s.regionMatches(true, i + 2, name, 0, name.length())) {
                    end = i + 2 + name.length();
                    break;
                }
            }
            if (end < 0 && s.startsWith("--user", i)) {
                end = i + 6;
            }
        } else if (s.startsWith("-u", i)) {
            end = i + 2;
        }
        return end >= 0 && end < n && Scan.blank(s.charAt(end)) ? end : -1;
    }

    /** Hides the value read at {@code at} when it is a secret; returns the index after what was consumed, or -1. */
    private static int hide(String s, int at, boolean user, Scan.Splice sp) {
        int n = s.length();
        if (at >= n) {
            return -1;
        }
        char q = s.charAt(at);
        boolean quoted = Scan.quote(q);
        int start = quoted ? at + 1 : at;
        int length;
        if (quoted) {
            length = Math.max(KeyValueScrub.quotedLength(s, start, q, 0), 0);
        } else {
            int e = start;
            while (e < n && !Scan.space(s.charAt(e))) {
                e++;
            }
            length = e - start;
        }
        if (length == 0 || s.charAt(start) == '-') {
            return -1;
        }
        if (!quoted) {
            while (length > 0 && TRAILING.indexOf(s.charAt(start + length - 1)) >= 0) {
                length--;
            }
        }
        String value = s.substring(start, start + length);
        if (user) {
            int colon = value.indexOf(':');
            if (colon < 1 || colon == value.length() - 1 || value.charAt(colon + 1) == '/') {
                return -1;
            }
            start += colon + 1;
            length -= colon + 1;
            value = value.substring(colon + 1);
        }
        if (!(Scan.looksSecret(value) || Scan.digitAndLetter(value))) {
            return -1;
        }
        sp.replace(start, start + length, R);
        return start + length;
    }
}
