package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Redactor;
import java.util.Locale;
import java.util.Set;

/**
 * The exportable form of an operator command (copy of the Paper rules, D-G and D-H). The text is split into whitespace
 * tokens; if any token, lower-cased and without a leading slash or {@code plugin:} prefix, is an authentication verb
 * ({@link #AUTH_ROOTS}), only the tokens up to and including that token are kept (a password has no recognisable shape),
 * so wrapped forms such as {@code execute as x run login pw} are covered. Names typed inside a command are exported as
 * typed (D-H). Everything else goes through {@link Redactor#scrub} and a byte cap.
 */
final class CommandText {
    static final int TEXT_MAX_BYTES = 1024;
    private static final int PRE_CAP_BYTES = 65536;

    static final Set<String> AUTH_ROOTS = Set.of(
            "login", "l", "log", "register", "reg", "changepassword", "changepass", "cp", "authme", "unregister", "unreg",
            "passwd", "password", "auth", "pass", "2fa", "totp", "setpassword", "loginsecurity", "lpassword", "nlogin",
            "captcha", "email", "setemail", "changeemail", "recovery", "pin", "setpin", "secret");

    private CommandText() {}

    static String exportable(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String text = ContentCap.cap(raw, PRE_CAP_BYTES);
        StringBuilder kept = new StringBuilder();
        int n = text.length();
        int i = 0;
        while (i < n) {
            while (i < n && separator(text.charAt(i))) {
                i++;
            }
            int j = i;
            while (j < n && !separator(text.charAt(j))) {
                j++;
            }
            if (j > i) {
                String token = text.substring(i, j);
                String norm = normalise(token);
                if (!norm.isEmpty()) {
                    boolean auth = AUTH_ROOTS.contains(norm);
                    if (kept.length() > 0) {
                        kept.append(' ');
                    }
                    kept.append(auth ? norm : token);
                    if (auth) {
                        return bound(kept.toString());
                    }
                }
            }
            i = j;
        }
        return bound(text);
    }

    private static String normalise(String token) {
        int s = 0;
        while (s < token.length() && token.charAt(s) == '/') {
            s++;
        }
        String word = token.substring(s).toLowerCase(Locale.ROOT);
        int colon = word.lastIndexOf(':');
        return colon >= 0 ? word.substring(colon + 1) : word;
    }

    private static boolean separator(char c) {
        return c <= ' ' || Character.isWhitespace(c) || Character.isSpaceChar(c) || Character.isISOControl(c);
    }

    private static String bound(String text) {
        return ContentCap.cap(Redactor.scrub(ContentCap.cap(text, PRE_CAP_BYTES)), TEXT_MAX_BYTES);
    }
}
