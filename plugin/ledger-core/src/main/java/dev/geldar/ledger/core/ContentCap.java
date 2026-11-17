package dev.geldar.ledger.core;

import java.nio.charset.StandardCharsets;

/** Caps content text at a UTF-8 byte limit (S3). Pure, no logging. */
public final class ContentCap {
    public static final int DEFAULT_MAX_BYTES = 32768;

    private ContentCap() {}

    public static String cap(String text) {
        return cap(text, DEFAULT_MAX_BYTES);
    }

    /**
     * Returns {@code text} itself when its UTF-8 form fits in {@code maxBytes}. Otherwise cuts at a
     * character boundary and appends {@code " [truncated:<originalBytes>]"}, so the whole result, marker
     * included, is at most {@code maxBytes} UTF-8 bytes (a cap smaller than the marker gives the marker alone).
     */
    public static String cap(String text, int maxBytes) {
        if (text == null || text.length() * 3L <= maxBytes) {
            return text;
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= maxBytes) {
            return text;
        }
        String marker = " [truncated:" + bytes.length + "]"; // ASCII: one byte per char
        int cut = Math.max(0, maxBytes - marker.length());
        while (cut > 0 && (bytes[cut] & 0xC0) == 0x80) {
            cut--;
        }
        return new String(bytes, 0, cut, StandardCharsets.UTF_8) + marker;
    }
}
