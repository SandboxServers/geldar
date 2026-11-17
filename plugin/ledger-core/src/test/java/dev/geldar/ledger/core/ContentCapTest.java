package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ContentCapTest {
    private static final String MARKER_40000 = " [truncated:40000]";

    @Test
    void shortTextIsTheSameInstance() {
        String s = "x".repeat(100);
        assertSame(s, ContentCap.cap(s, 32768));
        assertSame(s, ContentCap.cap(s));
        String exact = "y".repeat(32768);
        assertSame(exact, ContentCap.cap(exact));
    }

    @Test
    void asciiIsCutAtTheLimitWithMarker() {
        String out = ContentCap.cap("a".repeat(40000), 32768);
        assertEquals("a".repeat(32768) + MARKER_40000, out);
    }

    @Test
    void cutInsideThreeByteCharKeepsValidUtf8() throws CharacterCodingException {
        // 13333 three-byte chars = 39999 bytes + 1 ascii = 40000 bytes; 32768 is not a multiple of 3.
        String text = "€".repeat(13333) + "a";
        assertEquals(40000, text.getBytes(StandardCharsets.UTF_8).length);
        String out = ContentCap.cap(text, 32768);
        assertTrue(out.endsWith(MARKER_40000));
        String body = out.substring(0, out.length() - MARKER_40000.length());
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        assertEquals(32766, bytes.length);
        assertEquals("€".repeat(10922), body);
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes));
    }

    @Test
    void cutInsideSurrogatePairDropsWholePair() {
        String text = "😀".repeat(20); // 80 bytes, 4 each
        String out = ContentCap.cap(text, 10);
        assertEquals("😀".repeat(2) + " [truncated:80]", out);
    }
}
