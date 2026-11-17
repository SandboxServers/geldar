package dev.geldar.ledger.core;

/**
 * Free-text {@code key=value}, {@code key: value} and {@code "key":"value"} (also escaped): hides the value of a
 * credential key. The scan reads only {@code key + separator} first (never the value), at run starts only, so
 * it is one linear pass; a value is read only for a credential key and then within fixed caps.
 */
final class KeyValueScrub {
    private static final String R = Redactor.REDACTED;
    /** The most characters read for one quoted value; an unclosed quote costs at most this much. */
    static final int MAX_QUOTED_VALUE = 8192;
    /** The most characters read for one unquoted run, so a long run with many keys is not rescanned to its end. */
    static final int MAX_RUN = 512;
    private static final String TRAILING = ",;.)}]";
    private static final int MIN_QUERY_SECRET = 16;

    private KeyValueScrub() {}

    static String scrub(String s) {
        int n = s.length();
        Scan.Splice sp = new Scan.Splice(s);
        int i = 0;
        while (i < n) {
            char c = s.charAt(i);
            if (!Scan.keyChar(c) || (i > 0 && Scan.keyChar(s.charAt(i - 1)))) {
                i++;
                continue;
            }
            // A key run starts here and nowhere inside it.
            int e = i;
            while (e < n && Scan.keyChar(s.charAt(e))) {
                e++;
            }
            int keyStart = i;
            boolean flag = false;
            if (s.startsWith("--", i) && i + 2 < e && Scan.letter(s.charAt(i + 2))) {
                keyStart = i + 2;
                flag = true;
            } else if (!Scan.letter(c)) {
                i = e;
                continue;
            }
            int sepEnd = separatorEnd(s, e);
            if (sepEnd < 0) {
                i = e;
                continue;
            }
            i = sepEnd;
            String key = s.substring(keyStart, e);
            char prev = keyStart - (flag ? 2 : 0) > 0 ? s.charAt(keyStart - (flag ? 2 : 0) - 1) : '\0';
            boolean inQuery = (prev == '?' || prev == '&') && sepEnd - e == 1 && s.charAt(e) == '=';
            if (!CredentialKeys.isCredential(key) && !(inQuery && queryCredential(key, s, sepEnd))) {
                continue;
            }
            boolean flagOrQuery = flag || prev == '?' || prev == '&';
            int length = 0;
            boolean whole = false;
            if (CredentialKeys.isCookie(key)) {
                length = cookiePairs(s, sepEnd);
                whole = length > 0;
            }
            char last = s.charAt(sepEnd - 1);
            boolean quoted = Scan.quote(last);
            boolean quotedKey = quotedKey(s, e);
            if (!whole && quoted && (quotedKey || sepHas(s, e, sepEnd, '=') || flagOrQuery)) {
                int closer = 0;
                while (sepEnd - 2 - closer >= e && s.charAt(sepEnd - 2 - closer) == '\\') {
                    closer++;
                }
                length = Math.max(quotedLength(s, sepEnd, last, closer), 0);
                whole = length > 0;
            }
            if (!whole) {
                int runEnd = sepEnd;
                while (runEnd < n && valueChar(s.charAt(runEnd))) {
                    runEnd++;
                }
                int runLen = runEnd - sepEnd;
                int extended = delimitedSecretLength(s, sepEnd, runLen, quotedKey);
                length = extended > 0
                        ? extended
                        : flagOrQuery || Scan.looksSecret(s.substring(sepEnd, runEnd)) ? runLen : 0;
            }
            if (length == 0) {
                continue;
            }
            sp.replace(sepEnd, sepEnd + length, R);
            i = sepEnd + length;
        }
        return sp.finish();
    }

    /**
     * True when {@code key} after {@code ?} or {@code &} is a credential query parameter whose value starts at
     * {@code from}: {@code sig}, {@code X-Amz-Credential} and {@code X-Amz-Signature} always; {@code key} and
     * {@code code} only with a value run of 16 or more characters (never a plain word, which is shorter than 12).
     */
    private static boolean queryCredential(String key, String s, int from) {
        if (key.equalsIgnoreCase("sig") || key.equalsIgnoreCase("x-amz-credential")
                || key.equalsIgnoreCase("x-amz-signature")) {
            return true;
        }
        if (!key.equalsIgnoreCase("key") && !key.equalsIgnoreCase("code")) {
            return false;
        }
        int e = from;
        while (e < s.length() && e - from < MIN_QUERY_SECRET && valueChar(s.charAt(e))) {
            e++;
        }
        return e - from >= MIN_QUERY_SECRET;
    }

    /** End of {@code \\* ["']? [ \t]* [=:] [ \t]* \\* ["']?} read at {@code p}, or -1 when it does not match. */
    private static int separatorEnd(String s, int p) {
        int n = s.length();
        while (p < n && s.charAt(p) == '\\') {
            p++;
        }
        if (p < n && Scan.quote(s.charAt(p))) {
            p++;
        }
        while (p < n && Scan.blank(s.charAt(p))) {
            p++;
        }
        if (p >= n || (s.charAt(p) != '=' && s.charAt(p) != ':')) {
            return -1;
        }
        p++;
        while (p < n && Scan.blank(s.charAt(p))) {
            p++;
        }
        while (p < n && s.charAt(p) == '\\') {
            p++;
        }
        if (p < n && Scan.quote(s.charAt(p))) {
            p++;
        }
        return p;
    }

    /** True when the separator starts with backslashes then a quote: the key itself was quoted. */
    private static boolean quotedKey(String s, int p) {
        while (p < s.length() && s.charAt(p) == '\\') {
            p++;
        }
        return p < s.length() && Scan.quote(s.charAt(p));
    }

    private static boolean sepHas(String s, int from, int to, char c) {
        for (int i = from; i < to; i++) {
            if (s.charAt(i) == c) {
                return true;
            }
        }
        return false;
    }

    /** An unquoted value character: not whitespace, a quote, {@code & , ; ) } \}. */
    private static boolean valueChar(char c) {
        return !(Scan.space(c) || Scan.quote(c) || c == '&' || c == ',' || c == ';' || c == ')' || c == '}' || c == '\\');
    }

    /** A cookie header value in {@code name=value} form: the rest of the line; 0 when it has no pair. */
    private static int cookiePairs(String s, int from) {
        int n = s.length();
        int p = from;
        while (p < n && !Scan.space(s.charAt(p)) && s.charAt(p) != '=' && s.charAt(p) != ';' && !Scan.quote(s.charAt(p))) {
            p++;
        }
        if (p == from || p >= n || s.charAt(p) != '=') {
            return 0;
        }
        while (p < n && s.charAt(p) != '\r' && s.charAt(p) != '\n') {
            p++;
        }
        return p - from;
    }

    /**
     * The length of a quoted value starting at {@code from}, or -1 when no closing quote is found on the same line
     * within MAX_QUOTED_VALUE characters. {@code closer} is the number of backslashes the closing quote carries
     * (0 in plain JSON, 1 in JSON inside a JSON string, 3 one level deeper); a quote closes the value when the
     * backslash run before it is {@code closer} modulo {@code 2 * (closer + 1)}. One pass.
     */
    static int quotedLength(String s, int from, char quote, int closer) {
        int unit = 2 * (closer + 1);
        int limit = (int) Math.min(s.length(), (long) from + MAX_QUOTED_VALUE + closer + 1);
        int run = 0;
        for (int i = from; i < limit; i++) {
            char c = s.charAt(i);
            if (c == '\\') {
                run++;
            } else if (c == quote) {
                if (run % unit == closer) {
                    return i - from - closer;
                }
                run = 0;
            } else if (c == '\n' || c == '\r') {
                return -1;
            } else {
                run = 0;
            }
        }
        return -1;
    }

    /**
     * The value of an unquoted credential pair read to the next whitespace (at most MAX_RUN characters), so a
     * delimiter inside it ({@code Zq9x,K2mP7vL4Ab}) does not end it. Returns the length to hide: the whole run
     * when it is longer than the first segment and looks secret as a whole, else 0.
     */
    private static int delimitedSecretLength(String s, int from, int runLen, boolean quotedKey) {
        int n = s.length();
        int wholeEnd = from;
        while (wholeEnd < n && wholeEnd - from < MAX_RUN && !Scan.space(s.charAt(wholeEnd))) {
            wholeEnd++;
        }
        int len = wholeEnd - from;
        if (len <= runLen || Scan.quote(s.charAt(from))) {
            return 0;
        }
        int stop = len;
        for (int i = runLen; i < len; i++) {
            char c = s.charAt(from + i);
            if (Scan.quote(c) && (quotedKey || closesAfter(s, from, len, i))) {
                stop = i;
                break;
            }
            if ((c == ',' || c == ';' || c == '&') && pairStartsAt(s, from, len, i)) {
                stop = i;
                break;
            }
        }
        if (quotedKey) {
            while (stop > 0 && s.charAt(from + stop - 1) == '\\') {
                stop--;
            }
        }
        while (stop > 0 && TRAILING.indexOf(s.charAt(from + stop - 1)) >= 0) {
            stop--;
        }
        if (stop <= runLen) {
            return 0;
        }
        String value = s.substring(from, from + stop);
        return Scan.looksSecret(value) || Scan.digitAndLetter(value) ? stop : 0;
    }

    /** True when a quote at {@code at} ends the run: nothing follows it, or one of {@code , ; ) } ]} does. */
    private static boolean closesAfter(String s, int from, int len, int at) {
        if (at + 1 >= len) {
            return true;
        }
        char c = s.charAt(from + at + 1);
        return c == ',' || c == ';' || c == ')' || c == '}' || c == ']';
    }

    /** True when {@code ,name=value} (or {@code ;}, {@code &}) starts at {@code at}: an identifier, {@code =}, and a value that is not another {@code =}. */
    private static boolean pairStartsAt(String s, int from, int len, int at) {
        int i = at + 1;
        if (i >= len) {
            return false;
        }
        char first = s.charAt(from + i);
        if (!(Scan.letter(first) || first == '_')) {
            return false;
        }
        for (i++; i < len; i++) {
            char c = s.charAt(from + i);
            if (!(Scan.word(c) || c == '.' || c == '-')) {
                break;
            }
        }
        return i + 1 < len && s.charAt(from + i) == '=' && s.charAt(from + i + 1) != '=';
    }
}
