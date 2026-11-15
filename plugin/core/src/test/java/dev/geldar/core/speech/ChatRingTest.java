package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class ChatRingTest {
    private static final UUID AGENT = UUID.fromString("0f8fad5b-d9cb-469f-a165-8c967dc8d2a7");

    private static int count(String haystack, String needle) {
        int n = 0;
        for (int i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
            n++;
        }
        return n;
    }

    @Test
    void emptyRingIsVersionedWithNoLines() {
        assertEquals("{\"v\":1,\"lines\":[]}", new ChatRing().toJson());
    }

    @Test
    void jsonShapeIsVersionTimeIdAndText() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "hi there", 1234L);
        assertEquals("{\"v\":1,\"lines\":[{\"t\":1234,\"id\":\"0f8fad5b-d9cb-469f-a165-8c967dc8d2a7\","
                + "\"text\":\"hi there\"}]}", ring.toJson());
    }

    @Test
    void holdsOneHundredLinesAndEvictsTheOldest() {
        ChatRing ring = new ChatRing();
        for (int i = 0; i <= ChatRing.CAPACITY; i++) {
            ring.add(AGENT, "line-" + i, i);
        }
        String json = ring.toJson();
        assertEquals(100, count(json, "\"t\":"));
        assertFalse(json.contains("\"text\":\"line-0\""));
        assertTrue(json.contains("\"text\":\"line-1\""));
        assertTrue(json.contains("\"text\":\"line-100\""));
    }

    @Test
    void linesAreOldestFirst() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "first", 1L);
        ring.add(AGENT, "second", 2L);
        String json = ring.toJson();
        assertTrue(json.indexOf("\"first\"") < json.indexOf("\"second\""));
    }

    @Test
    void agentUsernamesInTextAreReplacedBeforeTheLineIsKept() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "hi ag_ash_01 and ag_bob_12!", 1L);
        ring.add(AGENT, "tag_ash_01x", 2L);
        String json = ring.toJson();
        assertTrue(json.contains("\"text\":\"hi Ranger and Ranger!\""));
        assertTrue(json.contains("\"text\":\"tag_ash_01x\""));
        assertFalse(json.contains("ag_ash_01 "));
    }

    @Test
    void quoteAndBackslashAreEscaped() {
        assertEquals("\"say \\\"x\\\" \\\\ y\"", ChatRing.quote("say \"x\" \\ y"));
    }

    @Test
    void controlCharactersBecomeUnicodeEscapes() {
        assertEquals("\"a\\u000ab\"", ChatRing.quote("a\nb"));
        assertEquals("\"\\u0007\\u001f\"", ChatRing.quote("\u0007\u001f"));
    }

    @Test
    void newlineInChatBecomesASpaceNotAnEscape() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "a\nb", 1L);
        assertTrue(ring.toJson().contains("\"text\":\"a b\""));
    }

    @Test
    void htmlIsNotEscapedSoScriptTagStaysText() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "</script><b>&</b>", 1L);
        assertTrue(ring.toJson().contains("\"text\":\"</script><b>&</b>\""));
    }

    @Test
    void emojiIsWrittenAsItsCharacters() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "😀 ok", 1L);
        assertTrue(ring.toJson().contains("\"text\":\"😀 ok\""));
    }

    @Test
    void textIsCappedAtTwoHundredFiftySixCodePoints() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "😀".repeat(300), 1L);
        String json = ring.toJson();
        assertTrue(json.contains("\"text\":\"" + "😀".repeat(256) + "\""));
        assertFalse(json.contains("😀".repeat(257)));
    }

    @Test
    void emptyTextIsSkipped() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "", 1L);
        ring.add(AGENT, "  \n\t ", 2L);
        ring.add(AGENT, null, 3L);
        assertEquals("{\"v\":1,\"lines\":[]}", ring.toJson());
    }

    @Test
    void idsAreUuidStrings() {
        ChatRing ring = new ChatRing();
        ring.add(AGENT, "x", 1L);
        assertTrue(ring.toJson().contains("\"id\":\"" + AGENT + "\""));
        assertEquals(36, AGENT.toString().length());
    }
}
