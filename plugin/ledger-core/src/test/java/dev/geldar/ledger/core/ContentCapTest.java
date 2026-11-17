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
        assertEquals("a".repeat(32768 - MARKER_40000.length()) + MARKER_40000, out);
        assertEquals(32768, out.getBytes(StandardCharsets.UTF_8).length);
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
        assertEquals(32748, bytes.length); // 32768 - 18 marker bytes = 32750, cut back to a boundary
        assertEquals("€".repeat(10916), body);
        assertTrue(out.getBytes(StandardCharsets.UTF_8).length <= 32768);
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes));
    }

    @Test
    void resultNeverExceedsTheCapForAnyCutPoint() {
        String text = "a€😀".repeat(40);
        for (int cap = 20; cap < 120; cap++) {
            String out = ContentCap.cap(text, cap);
            assertTrue(out.getBytes(StandardCharsets.UTF_8).length <= cap, "cap " + cap);
            assertTrue(out.endsWith(" [truncated:" + text.getBytes(StandardCharsets.UTF_8).length + "]"));
        }
    }

    @Test
    void cutInsideSurrogatePairDropsWholePair() {
        String text = "😀".repeat(20); // 80 bytes, 4 each
        String out = ContentCap.cap(text, 40);
        assertEquals("😀".repeat(6) + " [truncated:80]", out); // 40 - 15 = 25, cut back to 24
        assertTrue(out.getBytes(StandardCharsets.UTF_8).length <= 40);
    }
}
