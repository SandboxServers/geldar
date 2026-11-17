package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MiniJsonTest {
    private static Map<String, Long> parse(String s) {
        return StatsFileReader.parse(s.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void skipsEveryValueKindAndStillFindsTheStats() {
        String doc = "{\"DataVersion\":4000,\"a\":[1,-2.5e3,\"x\\\"\\u0041\\n\",true,false,null,{\"k\":[]}],"
                + "\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\":2,\"minecraft:other\":[1,2]}},\"z\":{}}";
        assertEquals(Map.of("deaths", 2L), parse(doc));
    }

    @Test
    void anEmptyStatsObjectIsAnEmptyResultNotNull() {
        assertEquals(Map.of(), parse("{\"stats\":{}}"));
    }

    @Test
    void truncatedOrMalformedTextIsNull() {
        for (String bad : new String[] {
            "", "{", "{\"stats\":", "{\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\":2", "{\"a\":1,}", "{\"a\":\"\\q\"}",
            "{\"a\":\"unterminated}", "{\"a\":tru}", "[1]", "{\"stats\":{}} x", "{\"a\":\"\\u12\"}", "{\"a\":\"\\uzzzz\"}"
        }) {
            assertNull(parse(bad), bad);
        }
    }

    @Test
    void nestingPastTheDepthCapIsRefused() {
        String deep = "{\"a\":" + "[".repeat(MiniJson.MAX_DEPTH + 2) + "]".repeat(MiniJson.MAX_DEPTH + 2) + "}";
        assertNull(parse(deep));
        assertThrows(IOException.class, () -> new MiniJson("@").peek());
    }
}
