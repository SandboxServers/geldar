package dev.geldar.ledger.core;

/**
 * Authorization headers and bearer strings in free text. Hand-written scanners: every character is read a
 * bounded number of times, so no input makes them quadratic.
 */
final class HeaderScrub {
    private static final String R = Redactor.REDACTED;
    private static final String AUTHORIZATION = "authorization";
    private static final String[] SCHEMES = {"basic", "bearer", "token", "negotiate", "ntlm"};
    private static final String[] LINE_SCHEMES = {"digest", "aws4-hmac-sha256"};

    private HeaderScrub() {}

    /** An Authorization or Proxy-Authorization header (also a quoted pair): scheme and rest, or a bare token run. */
    static String authorization(String s) {
        int n = s.length();
        Scan.Splice sp = new Scan.Splice(s);
        int i = 0;
        while (true) {
            int a = Scan.indexOfIgnoreCase(s, AUTHORIZATION, i);
            if (a < 0) {
                break;
            }
            i = a + 1;
            if (a > 0 && Scan.word(s.charAt(a - 1))) {
                continue;
            }
            int start = a;
            if (a >= 6 && s.regionMatches(true, a - 6, "proxy-", 0, 6) && (a == 6 || !Scan.word(s.charAt(a - 7)))) {
                start = a - 6;
            }
            int p = a + AUTHORIZATION.length();
            while (p < n && s.charAt(p) == '\\') {
                p++;
            }
            boolean quoted = false;
            if (p < n && Scan.quote(s.charAt(p))) {
                quoted = true;
                p++;
            }
            while (p < n && Scan.blank(s.charAt(p))) {
                p++;
            }
            if (p >= n || (s.charAt(p) != ':' && s.charAt(p) != '=')) {
                continue;
            }
            p++;
            while (p < n && Scan.blank(s.charAt(p))) {
                p++;
            }
            while (p < n && s.charAt(p) == '\\') {
                p++;
            }
            if (p < n && Scan.quote(s.charAt(p))) {
                quoted = true;
                p++;
            }
            int end = valueEnd(s, p);
            if (end < 0) {
                continue;
            }
            if (!quoted) {
                sp.replace(start, end, R);
            } else {
                // A quoted pair (JSON): the value ends at the closing quote or backslash.
                int cut = p;
                while (cut < end && !Scan.quote(s.charAt(cut)) && s.charAt(cut) != '\\') {
                    cut++;
                }
                sp.replace(p, cut, R);
            }
            i = end;
        }
        return sp.finish();
    }

    /** End of the header value starting at {@code p}, or -1 when none of the three value forms matches. */
    private static int valueEnd(String s, int p) {
        int n = s.length();
        for (String scheme : SCHEMES) {
            int q = afterScheme(s, p, scheme);
            if (q >= 0) {
                while (q < n && s.charAt(q) != '\r' && s.charAt(q) != '\n' && s.charAt(q) != '"'
                        && s.charAt(q) != '\'' && s.charAt(q) != '\\') {
                    q++;
                }
                return q;
            }
        }
        for (String scheme : LINE_SCHEMES) {
            int q = afterScheme(s, p, scheme);
            if (q >= 0) {
                while (q < n && s.charAt(q) != '\r' && s.charAt(q) != '\n') {
                    q++;
                }
                return q;
            }
        }
        int r = p;
        boolean proof = false;
        while (r < n && bareChar(s.charAt(r))) {
            char c = s.charAt(r);
            proof |= Scan.digit(c) || c == '.' || c == '_' || c == '~' || c == '+' || c == '/' || c == '=';
            r++;
        }
        return r - p >= 16 && proof ? r : -1;
    }

    /** The index after {@code scheme} and its blanks, or -1 when the scheme and at least one blank are not there. */
    private static int afterScheme(String s, int p, String scheme) {
        int len = scheme.length();
        if (!s.regionMatches(true, p, scheme, 0, len) || p + len >= s.length() || !Scan.blank(s.charAt(p + len))) {
            return -1;
        }
        int q = p + len;
        while (q < s.length() && Scan.blank(s.charAt(q))) {
            q++;
        }
        return q;
    }

    private static boolean bareChar(char c) {
        return Scan.word(c) && c != '_' || c == '.' || c == '_' || c == '~' || c == '+' || c == '/' || c == '=' || c == '-';
    }

    /** {@code bearer <run>} (also {@code Bearer: <run>}, {@code Bearer "<run>"}), the run being 6 or more characters. */
    static String bearer(String s) {
        int n = s.length();
        Scan.Splice sp = new Scan.Splice(s);
        int i = 0;
        while (true) {
            int b = Scan.indexOfIgnoreCase(s, "bearer", i);
            if (b < 0) {
                break;
            }
            i = b + 1;
            if (b > 0 && Scan.word(s.charAt(b - 1))) {
                continue;
            }
            int p = b + 6;
            int q = p;
            while (q < n && Scan.blank(s.charAt(q))) {
                q++;
            }
            int[] hit = null;
            if (q < n && (s.charAt(q) == ':' || s.charAt(q) == '=')) {
                q++;
                while (q < n && Scan.blank(s.charAt(q))) {
                    q++;
                }
                hit = run(s, q);
            }
            if (hit == null && p < n && Scan.blank(s.charAt(p))) {
                q = p;
                while (q < n && Scan.blank(s.charAt(q))) {
                    q++;
                }
                hit = run(s, q);
            }
            if (hit == null) {
                continue;
            }
            String word = s.substring(b, b + 6);
            String value = s.substring(hit[1], hit[2]);
            boolean capital = word.equals("Bearer") || word.equals("BEARER");
            if (capital ? Scan.looksSecret(value) : proof(value) || value.length() >= 20) {
                sp.replace(b, hit[2], hit[0] == 0 ? R : s.charAt(hit[1] - 1) + R);
            }
            i = hit[2];
        }
        return sp.finish();
    }

    /** {hasQuote(0|1), runStart, runEnd} for an optional quote then a run of 6 or more non-delimiters, else null. */
    private static int[] run(String s, int q) {
        int n = s.length();
        int start = q;
        boolean quoted = q < n && Scan.quote(s.charAt(q));
        if (quoted) {
            start++;
        }
        int e = start;
        while (e < n && !delimiter(s.charAt(e))) {
            e++;
        }
        return e - start >= 6 ? new int[] {quoted ? 1 : 0, start, e} : null;
    }

    private static boolean delimiter(char c) {
        return Scan.space(c) || Scan.quote(c) || c == ',' || c == ';';
    }

    private static boolean proof(String v) {
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            if (Scan.digit(c) || c == '_' || c == '~' || c == '+' || c == '/' || c == '=' || c == '-') {
                return true;
            }
        }
        return false;
    }
}
