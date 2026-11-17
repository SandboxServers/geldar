package dev.geldar.core.trace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SpeechHashTest {
    @Test
    void isStableSixteenLowerHexAndDoesNotContainTheText() {
        String h = SpeechHash.of("hello");
        assertEquals("2cf24dba5fb0a30e", h);
        assertEquals(h, SpeechHash.of("hello"));
        assertTrue(h.matches("[0-9a-f]{16}"));
        assertNotEquals(h, SpeechHash.of("hellp"));
    }

    @Test
    void hashesTheUtf8Bytes() {
        assertTrue(SpeechHash.of("h\u00e9llo \u2603").matches("[0-9a-f]{16}"));
        assertTrue(SpeechHash.of("").matches("[0-9a-f]{16}"));
    }
}
