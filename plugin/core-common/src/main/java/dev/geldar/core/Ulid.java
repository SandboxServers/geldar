package dev.geldar.core;

import java.security.SecureRandom;

/** Minimal ULID generator: 48-bit millisecond timestamp plus 80 random bits, Crockford base32. */
public final class Ulid {
    private static final char[] ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    private static final SecureRandom RANDOM = new SecureRandom();

    private Ulid() {}

    /** Returns a new 26 character ULID for the given epoch millisecond. */
    public static String generate(long epochMillis) {
        char[] out = new char[26];
        long time = epochMillis;
        for (int i = 9; i >= 0; i--) {
            out[i] = ALPHABET[(int) (time & 31)];
            time >>>= 5;
        }
        for (int i = 10; i < 26; i++) {
            out[i] = ALPHABET[RANDOM.nextInt(32)];
        }
        return new String(out);
    }
}