package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class SpeechTextTest {

    @Test
    void keepsHtmlCharactersAsPlainText() {
        assertEquals(Optional.of("<b>&\"'</b>"), SpeechText.clean("<b>&\"'</b>"));
    }

    @Test
    void stripsNewlinesAndControlCharacters() {
        assertEquals(Optional.of("a b c d e f"), SpeechText.clean("a\nb\rc\u0000d\te\u0007f"));
        assertEquals(Optional.of("a b"), SpeechText.clean("a b"));
        assertEquals(Optional.of("a b"), SpeechText.clean("a‮b"));
    }

    @Test
    void collapsesWhitespaceAndTrims() {
        assertEquals(Optional.of("hello there"), SpeechText.clean("  hello \n\n   there  "));
    }

    @Test
    void replacesAgentUsernamesWithRanger() {
        assertEquals(Optional.of("hi Ranger and Ranger!"), SpeechText.clean("hi ag_ash_01 and ag_bob_12!"));
        assertEquals(Optional.of("Ranger"), SpeechText.clean("ag_kestrel_01"));
    }

    @Test
    void leavesWordsThatOnlyLookLikeUsernamesAlone() {
        String text = "ag_ tag_ash_01x ag_ash_1 ag_Ash_01 ag_ash_01x";
        assertEquals(Optional.of(text), SpeechText.clean(text));
    }

    @Test
    void capsAtTwoHundredFiftySixCodePoints() {
        String shown = SpeechText.clean("a".repeat(300)).orElseThrow();
        assertEquals("a".repeat(256), shown);
        assertEquals(Optional.of("a".repeat(256)), SpeechText.clean("a".repeat(256)));
    }

    @Test
    void capCountsCodePointsNotChars() {
        String emoji = "😀".repeat(300);
        String shown = SpeechText.clean(emoji).orElseThrow();
        assertEquals(256, shown.codePointCount(0, shown.length()));
        assertEquals("😀".repeat(256), shown);
    }

    @Test
    void blankAndNullGiveEmpty() {
        assertEquals(Optional.empty(), SpeechText.clean("   \n\t  "));
        assertEquals(Optional.empty(), SpeechText.clean("\u0000\u0001"));
        assertEquals(Optional.empty(), SpeechText.clean(null));
    }
}
