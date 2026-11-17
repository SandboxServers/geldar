package dev.geldar.ledger.core;

import java.util.regex.Pattern;

/**
 * The one place that scrubs values before they leave the plugin (S4, S5). Pure and thread-safe.
 * Nothing here logs a value. Scanning is linear: address candidates are found by one pass over
 * the string and validated by hand, so no regex backtracks on adversarial input.
 */
public final class Redactor {
    public static final String REDACTED = "[redacted]";
    public static final String ADDR = "[addr]";

    private static final Pattern CREDENTIAL_KEY = Pattern.compile(
            "password|passwd|secret|token|authorization|api[_-]?key|cookie|credential|private[_-]?key",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern IPV4 = Pattern.compile(
            "(?<![0-9A-Za-z.])(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}"
                    + "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?![0-9A-Za-z]|\\.[0-9])");

    private Redactor() {}

    /** True when the attribute key looks like it carries a credential. */
    public static boolean keyIsCredential(String key) {
        return key != null && CREDENTIAL_KEY.matcher(key).find();
    }

    /** Replaces IPv4 and IPv6 literals with {@code [addr]}; everything else stays byte-identical. */
    public static String scrub(String value) {
        if (value == null || value.length() < 3) {
            return value;
        }
        String s = value;
        if (s.indexOf(':') >= 0) {
            s = scrubV6(s);
        }
        if (s.indexOf('.') >= 0) {
            s = IPV4.matcher(s).replaceAll(ADDR);
        }
        return s;
    }

    /** A credential-looking key gives {@code [redacted]}; a String value is scrubbed; others pass. */
    public static Object redactAttr(String key, Object value) {
        if (keyIsCredential(key)) {
            return REDACTED;
        }
        if (value instanceof String str) {
            return scrub(str);
        }
        return value;
    }

    private static boolean isRunChar(char c) {
        return c == ':' || c == '.' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }

    private static boolean isWord(char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
    }

    private static String scrubV6(String s) {
        int n = s.length();
        StringBuilder out = null;
        int copied = 0;
        int i = 0;
        while (i < n) {
            if (!isRunChar(s.charAt(i))) {
                i++;
                continue;
            }
            int start = i;
            while (i < n && isRunChar(s.charAt(i))) {
                i++;
            }
            int end = i;
            // Trim sentence punctuation that is not part of the address.
            while (end > start && s.charAt(end - 1) == '.') {
                end--;
            }
            if (end - start >= 2 && s.charAt(end - 1) == ':' && s.charAt(end - 2) != ':') {
                end--;
            }
            if (end - start >= 2 && s.charAt(start) == ':' && s.charAt(start + 1) != ':') {
                start++;
            }
            if (end - start < 3 || (start > 0 && isWord(s.charAt(start - 1))) || (end < n && isWord(s.charAt(end)))) {
                continue;
            }
            if (!validV6(s, start, end)) {
                continue;
            }
            int from = start;
            int to = end;
            if (from > 0 && s.charAt(from - 1) == '[' && to < n && s.charAt(to) == ']') {
                from--;
                to++;
                int p = to;
                if (p < n && s.charAt(p) == ':') {
                    p++;
                    int digits = p;
                    while (p < n && p - digits < 5 && s.charAt(p) >= '0' && s.charAt(p) <= '9') {
                        p++;
                    }
                    if (p > digits) {
                        to = p;
                    }
                }
            }
            if (out == null) {
                out = new StringBuilder(n);
            }
            out.append(s, copied, from).append(ADDR);
            copied = to;
            i = Math.max(i, to);
        }
        if (out == null) {
            return s;
        }
        return out.append(s, copied, n).toString();
    }

    /** Strict IPv6 text form: groups of 1-4 hex digits, one optional "::", optional trailing IPv4. */
    private static boolean validV6(String s, int start, int end) {
        int groups = 0;
        boolean compressed = false;
        boolean sawHex = false;
        int i = start;
        if (end - i >= 2 && s.charAt(i) == ':' && s.charAt(i + 1) == ':') {
            compressed = true;
            i += 2;
            if (i == end) {
                return false;
            }
        } else if (s.charAt(i) == ':') {
            return false;
        }
        while (i < end) {
            int g = i;
            while (i < end && isHex(s.charAt(i))) {
                i++;
            }
            int len = i - g;
            if (i < end && s.charAt(i) == '.' && len > 0) {
                // trailing dotted quad counts as two groups and must end the address
                if (!dottedQuad(s, g, end)) {
                    return false;
                }
                groups += 2;
                i = end;
                sawHex = true;
                break;
            }
            if (len < 1 || len > 4) {
                return false;
            }
            sawHex = true;
            groups++;
            if (i == end) {
                break;
            }
            if (s.charAt(i) != ':') {
                return false;
            }
            if (i + 1 < end && s.charAt(i + 1) == ':') {
                if (compressed) {
                    return false;
                }
                compressed = true;
                i += 2;
            } else {
                i++;
                if (i == end) {
                    return false;
                }
            }
        }
        if (!sawHex) {
            return false;
        }
        return compressed ? groups <= 7 : groups == 8;
    }

    private static boolean isHex(char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }

    private static boolean dottedQuad(String s, int start, int end) {
        int parts = 0;
        int i = start;
        while (i < end) {
            int g = i;
            int v = 0;
            while (i < end && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
                v = v * 10 + (s.charAt(i) - '0');
                i++;
                if (i - g > 3) {
                    return false;
                }
            }
            if (i == g || v > 255) {
                return false;
            }
            parts++;
            if (i == end) {
                break;
            }
            if (s.charAt(i) != '.') {
                return false;
            }
            i++;
            if (i == end) {
                return false;
            }
        }
        return parts == 4;
    }
}
