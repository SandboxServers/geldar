package dev.geldar.ledger.core;

/** Character classes and small tests shared by the credential scanners. All of them are O(1) or O(length). */
final class Scan {
    private Scan() {}

    /** ASCII word character, the JavaScript {@code \w}. */
    static boolean word(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    }

    /** A character of a free-text key: word, dot or hyphen. */
    static boolean keyChar(char c) {
        return word(c) || c == '.' || c == '-';
    }

    static boolean letter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    static boolean digit(char c) {
        return c >= '0' && c <= '9';
    }

    static boolean blank(char c) {
        return c == ' ' || c == '\t';
    }

    static boolean quote(char c) {
        return c == '"' || c == '\'';
    }

    /** The JavaScript {@code \s} class, so the Java scrub splits text where the TypeScript one does. */
    static boolean space(char c) {
        if (c == ' ' || (c >= '\t' && c <= '\r')) {
            return true;
        }
        return c == ' ' || c == ' ' || (c >= ' ' && c <= ' ') || c == ' ' || c == ' '
                || c == ' ' || c == ' ' || c == '　' || c == '﻿';
    }

    /** Index of {@code lower} (given in lower case) in {@code s} at or after {@code from}, ignoring ASCII case. */
    static int indexOfIgnoreCase(String s, String lower, int from) {
        int n = s.length() - lower.length();
        char first = lower.charAt(0);
        for (int i = Math.max(from, 0); i <= n; i++) {
            char c = s.charAt(i);
            if ((c == first || c == first - 32) && s.regionMatches(true, i, lower, 0, lower.length())) {
                return i;
            }
        }
        return -1;
    }

    /** A single plain word ("north", "Alexander"): a letter then lower-case letters, shorter than 12. */
    static boolean plainWord(String v) {
        if (v.length() >= 12 || v.isEmpty() || !letter(v.charAt(0))) {
            return false;
        }
        for (int i = 1; i < v.length(); i++) {
            char c = v.charAt(i);
            if (c < 'a' || c > 'z') {
                return false;
            }
        }
        return true;
    }

    /** An unquoted value that looks like a secret: 8 or more characters and not a plain word. */
    static boolean looksSecret(String v) {
        return v.length() >= 8 && !plainWord(v);
    }

    /** True when {@code v} has an ASCII digit and an ASCII letter. */
    static boolean digitAndLetter(String v) {
        boolean d = false;
        boolean l = false;
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            d |= digit(c);
            l |= letter(c);
        }
        return d && l;
    }

    /** Edits one string left to right without copying it more than once. */
    static final class Splice {
        private final String text;
        private StringBuilder out;
        private int last;

        Splice(String text) {
            this.text = text;
        }

        /** Replaces {@code [from, to)}; edits must come in order and not overlap. */
        void replace(int from, int to, String with) {
            if (out == null) {
                out = new StringBuilder(text.length() + 16);
            }
            out.append(text, last, from).append(with);
            last = to;
        }

        String finish() {
            return out == null ? text : out.append(text, last, text.length()).toString();
        }
    }
}
