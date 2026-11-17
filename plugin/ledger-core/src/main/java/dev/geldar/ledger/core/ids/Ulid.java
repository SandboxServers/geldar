package dev.geldar.ledger.core.ids;

import java.security.SecureRandom;
import java.util.function.LongSupplier;

/**
 * A ULID: 26 Crockford base32 characters, 48 bits of millisecond time then 80 bits of randomness, so ids sort by time.
 * Within one millisecond (or when the clock steps back) the random part is incremented, so a generator never repeats
 * or goes down. Thread safe. The id carries no information about the thing it names.
 */
public final class Ulid {
    private static final char[] ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    private static final long TIME_MASK = (1L << 48) - 1;
    private static final Generator SHARED = new Generator(System::currentTimeMillis, new SecureRandom());

    private Ulid() {}

    /** The next id from the process-wide generator. */
    public static String next() {
        return SHARED.next();
    }

    /** An independent generator; tests give it a fixed clock and a seeded random. */
    public static final class Generator {
        private final LongSupplier clock;
        private final java.util.Random random;
        private long lastMs = -1;
        private long hi; // top 16 of the 80 random bits
        private long lo; // low 64 of the 80 random bits

        public Generator(LongSupplier clock, java.util.Random random) {
            this.clock = clock;
            this.random = random;
        }

        public synchronized String next() {
            long now = clock.getAsLong() & TIME_MASK;
            if (now > lastMs) {
                lastMs = now;
                hi = random.nextInt(1 << 16);
                lo = random.nextLong();
            } else {
                // same millisecond, or the clock went back: keep the last time and count up
                lo++;
                if (lo == 0) {
                    hi = (hi + 1) & 0xFFFF;
                    if (hi == 0) {
                        lastMs = (lastMs + 1) & TIME_MASK;
                    }
                }
            }
            return encode((lastMs << 16) | hi, lo);
        }
    }

    /** 128 bits (high word, low word) as 26 characters: 3 bits, then 25 groups of 5. */
    static String encode(long high, long low) {
        char[] out = new char[26];
        long h = high;
        long l = low;
        for (int i = 25; i >= 0; i--) {
            out[i] = ALPHABET[(int) (l & 31)];
            l = (l >>> 5) | (h << 59);
            h >>>= 5;
        }
        return new String(out);
    }
}
