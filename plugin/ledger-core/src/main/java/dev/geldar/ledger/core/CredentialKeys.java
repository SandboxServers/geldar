package dev.geldar.ledger.core;

import java.util.Set;

/**
 * The free-text key rule: a key is a credential only when its last word says so ("password", "api_key"), not
 * when a stem merely sits inside it ("secretary", "cookies", "tokens"). Words are split exactly as
 * {@link Redactor#keyIsCredential} splits them (at dot, underscore, hyphen and camelCase boundaries).
 */
final class CredentialKeys {
    private static final Set<String> WORDS = Set.of(
            "password", "passwd", "passphrase", "secret", "token", "cookie", "apikey", "signature", "jwt", "auth");
    private static final Set<String> PAIRS =
            Set.of("apikey", "privatekey", "secretkey", "accesskey", "signingkey", "sshkey", "sessionid");

    private CredentialKeys() {}

    /** True when the last word is a credential word, or the last two together name one. One pass. */
    static boolean isCredential(String key) {
        int n = key.length();
        String last = null;
        String before = null;
        boolean sawSecret = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i <= n; i++) {
            boolean end = i == n;
            char ch = end ? '.' : key.charAt(i);
            boolean sep = end || ch == '.' || ch == '_' || ch == '-';
            boolean boundary = false;
            if (!sep && i > 0 && ch >= 'A' && ch <= 'Z') {
                char p = key.charAt(i - 1);
                boundary = (p >= 'a' && p <= 'z') || (p >= '0' && p <= '9')
                        || (p >= 'A' && p <= 'Z' && i + 1 < n && key.charAt(i + 1) >= 'a' && key.charAt(i + 1) <= 'z');
            }
            if (sep || boundary) {
                if (cur.length() > 0) {
                    before = last;
                    last = cur.toString();
                    sawSecret |= last.equals("secret");
                    cur.setLength(0);
                }
            }
            if (!sep) {
                cur.append(Character.toLowerCase(ch));
            }
        }
        if (last == null) {
            return false;
        }
        if (WORDS.contains(last)) {
            return true;
        }
        if (before != null && PAIRS.contains(before + last)) {
            return true;
        }
        return last.equals("key") && sawSecret;
    }

    /** True when the key is {@code cookie} or ends in a separator and {@code cookie}, ignoring case. */
    static boolean isCookie(String key) {
        int n = key.length();
        if (n < 6 || !key.regionMatches(true, n - 6, "cookie", 0, 6)) {
            return false;
        }
        if (n == 6) {
            return true;
        }
        char p = key.charAt(n - 7);
        return p == '.' || p == '_' || p == '-';
    }
}
