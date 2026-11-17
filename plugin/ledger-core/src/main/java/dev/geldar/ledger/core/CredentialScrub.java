package dev.geldar.ledger.core;

/**
 * Credential-only scrub for free text (decision 0350): a port of the TypeScript {@code scrubText} in
 * {@code telemetry/src/redact.ts}. Ordinary game text passes unchanged; only text that is a credential is
 * replaced by {@code [redacted]}. Every scanner is a hand-written single pass with fixed look-ahead caps, so
 * the whole scrub is linear in the text length (no regex runs on user text). Pure and thread-safe.
 */
final class CredentialScrub {
    private static final String R = Redactor.REDACTED;
    private static final String PEM_BEGIN = "-----BEGIN ";
    private static final String PEM_FOOTER = "PRIVATE KEY-----";
    private static final int PEM_LABEL_MAX = 40;
    private static final int SCHEME_MAX = 32;

    private CredentialScrub() {}

    /** The text with every credential value replaced; on any failure the text is dropped, never returned as is. */
    static String scrub(String text) {
        try {
            return KeyValueScrub.scrub(userinfo(mcpToken(HeaderScrub.bearer(jwt(HeaderScrub.authorization(FlagScrub.scrub(pem(text))))))));
        } catch (RuntimeException | StackOverflowError e) {
            return "[unscrubbable " + text.length() + " chars]";
        }
    }

    /** PEM private key blocks: from the BEGIN line to the END line, or to the end of the text when it is cut. */
    static String pem(String s) {
        int from = s.indexOf(PEM_BEGIN);
        if (from < 0) {
            return s;
        }
        Scan.Splice sp = new Scan.Splice(s);
        while (from >= 0) {
            int headerEnd = pemHeaderEnd(s, from + PEM_BEGIN.length());
            if (headerEnd < 0) {
                from = s.indexOf(PEM_BEGIN, from + 1);
                continue;
            }
            int footer = s.indexOf(PEM_FOOTER, headerEnd);
            int stop = footer < 0 ? s.length() : footer + PEM_FOOTER.length();
            sp.replace(from, stop, R);
            from = s.indexOf(PEM_BEGIN, stop);
        }
        return sp.finish();
    }

    /** End of {@code [A-Z ]{0,40}PRIVATE KEY-----} read at {@code p}, or -1: at most 41 starts of a 16-char test. */
    private static int pemHeaderEnd(String s, int p) {
        for (int j = 0; j <= PEM_LABEL_MAX; j++) {
            if (s.startsWith(PEM_FOOTER, p + j)) {
                return p + j + PEM_FOOTER.length();
            }
            if (p + j >= s.length()) {
                return -1;
            }
            char c = s.charAt(p + j);
            if (!((c >= 'A' && c <= 'Z') || c == ' ')) {
                return -1;
            }
        }
        return -1;
    }

    /** A bare JWT: three base64url segments, the first starting {@code eyJ}, starting only at a run start. */
    static String jwt(String s) {
        int n = s.length();
        Scan.Splice sp = new Scan.Splice(s);
        int i = s.indexOf("eyJ");
        while (i >= 0) {
            if (i > 0 && jwtChar(s.charAt(i - 1))) {
                i = s.indexOf("eyJ", i + 1);
                continue;
            }
            int a = i + 3;
            int e1 = runEnd(s, a);
            int e3 = -1;
            if (e1 - a >= 5 && e1 < n && s.charAt(e1) == '.') {
                int e2 = runEnd(s, e1 + 1);
                if (e2 - (e1 + 1) >= 8 && e2 < n && s.charAt(e2) == '.') {
                    e3 = runEnd(s, e2 + 1);
                }
            }
            if (e3 >= 0) {
                sp.replace(i, e3, R);
                i = s.indexOf("eyJ", e3);
            } else {
                i = s.indexOf("eyJ", i + 1);
            }
        }
        return sp.finish();
    }

    private static boolean jwtChar(char c) {
        return Scan.word(c) || c == '-';
    }

    private static int runEnd(String s, int from) {
        int e = from;
        while (e < s.length() && jwtChar(s.charAt(e))) {
            e++;
        }
        return e;
    }

    /** {@code gmcp-} and 64 lower-case hex characters. */
    static String mcpToken(String s) {
        int i = s.indexOf("gmcp-");
        if (i < 0) {
            return s;
        }
        Scan.Splice sp = new Scan.Splice(s);
        while (i >= 0) {
            int end = i + 5 + 64;
            if (end <= s.length() && hex(s, i + 5, end)) {
                sp.replace(i, end, R);
                i = s.indexOf("gmcp-", end);
            } else {
                i = s.indexOf("gmcp-", i + 1);
            }
        }
        return sp.finish();
    }

    private static boolean hex(String s, int from, int to) {
        for (int i = from; i < to; i++) {
            char c = s.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                return false;
            }
        }
        return true;
    }

    /**
     * URL userinfo {@code scheme://user:pass@}: the password runs to the last {@code @} before the next {@code /} or
     * space. The scheme is a letter then at most 31 of {@code [A-Za-z0-9+.-]}; a longer run is read by its last 32.
     */
    static String userinfo(String s) {
        int n = s.length();
        int q = s.indexOf("://");
        if (q < 0) {
            return s;
        }
        Scan.Splice sp = new Scan.Splice(s);
        int floor = 0;
        while (q >= 0) {
            int next = q + 3;
            int w = q;
            while (w > floor && q - w < SCHEME_MAX && schemeChar(s.charAt(w - 1))) {
                w--;
            }
            while (w < q && !Scan.letter(s.charAt(w))) {
                w++;
            }
            int p = next;
            if (w < q) {
                while (p < n && !Scan.space(s.charAt(p)) && s.charAt(p) != '/' && s.charAt(p) != '@' && s.charAt(p) != ':') {
                    p++;
                }
                if (p < n && s.charAt(p) == ':') {
                    int at = -1;
                    for (int r = p + 1; r < n && !Scan.space(s.charAt(r)) && s.charAt(r) != '/'; r++) {
                        if (s.charAt(r) == '@') {
                            at = r;
                        }
                    }
                    if (at >= 0) {
                        sp.replace(next, at, R);
                        floor = at + 1;
                        q = s.indexOf("://", floor);
                        continue;
                    }
                }
            }
            q = s.indexOf("://", next);
        }
        return sp.finish();
    }

    private static boolean schemeChar(char c) {
        return Scan.letter(c) || Scan.digit(c) || c == '+' || c == '.' || c == '-';
    }
}
