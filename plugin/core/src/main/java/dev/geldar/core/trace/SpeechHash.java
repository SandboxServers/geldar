package dev.geldar.core.trace;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * A short, unsalted fingerprint of a spoken line, for correlating a speech across spans. It is the first 8 bytes of
 * SHA-256 as 16 hex characters. Privacy limit (S3): the card asks for no salt, so a short or guessable message
 * ("hi", "yes") can be recovered by hashing candidates. The hash is therefore span-only and must never be a metric
 * attribute, and it is not an anonymiser.
 */
public final class SpeechHash {
    private SpeechHash() {}

    public static String of(String text) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
