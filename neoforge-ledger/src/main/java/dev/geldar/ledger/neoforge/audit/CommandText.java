package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.ContentCap;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The exportable form of an operator command: the command NAME and the argument COUNT, never an argument (owner
 * decision of 2026-11-17: this supersedes D-H, so a name typed as an argument is no longer exported). The text is split
 * into whitespace tokens (unicode spaces and control characters separate). The name is the first token, lower-cased,
 * without leading slashes or a {@code plugin:} prefix; {@code execute ... run <command>} (nested too) is unwrapped to
 * the inner command, so {@code execute as @a run say hi} is name {@code say}, count 1. An authentication verb
 * ({@link #AUTH_ROOTS}) exports its name and count 0 (a password has no recognisable shape, and its length is a leak).
 * A name that is not plain ({@code [a-z0-9_.+-]}, at most 64 characters: unicode tricks, an accidentally typed secret)
 * is exported as {@code unknown}. The arguments are counted and then dropped, never copied.
 */
final class CommandText {
    static final int NAME_MAX = 64;
    static final int COUNT_MAX = 10_000;
    static final String UNKNOWN = "unknown";
    private static final int PRE_CAP_BYTES = 65536;

    static final Set<String> AUTH_ROOTS = Set.of(
            "login", "l", "log", "register", "reg", "changepassword", "changepass", "cp", "authme", "unregister", "unreg",
            "passwd", "password", "auth", "pass", "2fa", "totp", "setpassword", "loginsecurity", "lpassword", "nlogin",
            "captcha", "email", "setemail", "changeemail", "recovery", "pin", "setpin", "secret");

    /** The command name ({@code ""} for no command) and how many arguments followed it. */
    record Parsed(String name, int argCount) {}

    private CommandText() {}

    /** The command name only (see {@link #parse}). */
    static String exportable(String raw) {
        return parse(raw).name();
    }

    static Parsed parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return new Parsed("", 0);
        }
        String text = ContentCap.cap(raw, PRE_CAP_BYTES);
        List<String> tokens = new ArrayList<>();
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
                tokens.add(text.substring(i, j));
            }
            i = j;
        }
        int pos = 0;
        while (pos < tokens.size() && normalise(tokens.get(pos)).equals("execute")) {
            int run = -1;
            for (int k = pos + 1; k < tokens.size(); k++) {
                if (tokens.get(k).equalsIgnoreCase("run") && k + 1 < tokens.size()) {
                    run = k;
                    break;
                }
            }
            if (run < 0) {
                break;
            }
            pos = run + 1;
        }
        if (pos >= tokens.size()) {
            return new Parsed("", 0);
        }
        String name = normalise(tokens.get(pos));
        if (name.isEmpty()) {
            return new Parsed("", 0);
        }
        if (AUTH_ROOTS.contains(name)) {
            return new Parsed(name, 0);
        }
        if (!plain(name)) {
            name = UNKNOWN;
        }
        return new Parsed(name, Math.min(COUNT_MAX, tokens.size() - pos - 1));
    }

    private static boolean plain(String name) {
        if (name.isEmpty() || name.length() > NAME_MAX) {
            return false;
        }
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '+' || c == '-')) {
                return false;
            }
        }
        return true;
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
}