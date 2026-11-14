package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class SpeechTextTest {

    @Test
    void escapesEachHtmlCharacter() {
        assertEquals(Optional.of("&amp;&lt;&gt;&quot;&#39;"), SpeechText.clean("&<>\"'"));
    }

    @Test
    void stripsNewlinesAndControlCharacters() {
        assertEquals(Optional.of("a b c d e f"), SpeechText.clean("a\nb\rc\u0000d\te\u0007f"));
        assertEquals(Optional.of("a b"), SpeechText.clean("a b"));
        assertEquals(Optional.of("a b"), SpeechText.clean("a‮b"));
    }

    @Test
    void collapsesWhitespaceAndTrims() {
        assertEquals(Optional.of("hello there"), SpeechText.clean("  hello \n\n   there  "));
    }

    @Test
    void capsAtOneHundredFortyWithEllipsis() {
        String longLine = "a".repeat(200);
        String shown = SpeechText.clean(longLine).orElseThrow();
        assertEquals("a".repeat(137) + "...", shown);
        assertEquals(140, shown.length());
    }

    @Test
    void capCountsCodePointsNotChars() {
        String emoji = "😀".repeat(200);
        String shown = SpeechText.clean(emoji).orElseThrow();
        assertEquals(140, shown.codePointCount(0, shown.length()));
        assertTrue(shown.endsWith("..."));
    }

    @Test
    void blankAndNullGiveEmpty() {
        assertEquals(Optional.empty(), SpeechText.clean("   \n\t  "));
        assertEquals(Optional.empty(), SpeechText.clean("\u0000\u0001"));
        assertEquals(Optional.empty(), SpeechText.clean(null));
    }

    @Test
    void hostileInputNeverKeepsARawAngleBracket() {
        String shown = SpeechText.clean("<script>alert(1)</script>\"onmouseover=").orElseThrow();
        assertFalse(shown.contains("<"));
        assertFalse(shown.contains(">"));
        assertEquals("&lt;script&gt;alert(1)&lt;/script&gt;&quot;onmouseover=", shown);
    }

    @Test
    void htmlWrapperUsesInlineStylesOnly() {
        String html = SpeechText.html("hi");
        assertTrue(html.startsWith("<div style=\""));
        assertTrue(html.endsWith("\">hi</div>"));
        assertFalse(html.contains("class="));
        assertFalse(html.contains("<script"));
    }
}
