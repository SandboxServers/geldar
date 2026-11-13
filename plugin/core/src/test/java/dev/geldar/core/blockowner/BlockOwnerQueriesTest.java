package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.geldar.core.blockowner.BlockOwnerQueries.Query;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerQueryService.Answer;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import java.util.List;
import org.junit.jupiter.api.Test;

class BlockOwnerQueriesTest {
    @Test
    void parsesAWellFormedQuery() {
        Query q = BlockOwnerQueries.parse("{\"world\":\"world\",\"chunk_x\":-3,\"chunk_z\":12}").orElseThrow();

        assertEquals(new Query("world", -3, 12), q);
    }

    @Test
    void ignoresMalformedQueries() {
        String[] malformed = {
            null,
            "",
            "{",
            "[]",
            "\"world\"",
            "{}",
            "{\"world\":\"world\",\"chunk_x\":1}",
            "{\"world\":\"world\",\"chunk_x\":1,\"chunk_z\":2,\"extra\":true}",
            "{\"world\":7,\"chunk_x\":1,\"chunk_z\":2}",
            "{\"world\":\"\",\"chunk_x\":1,\"chunk_z\":2}",
            "{\"world\":\"" + "w".repeat(65) + "\",\"chunk_x\":1,\"chunk_z\":2}",
            "{\"world\":\"world\",\"chunk_x\":\"1\",\"chunk_z\":2}",
            "{\"world\":\"world\",\"chunk_x\":1.5,\"chunk_z\":2}",
            "{\"world\":\"world\",\"chunk_x\":1875001,\"chunk_z\":2}",
            "{\"world\":\"world\",\"chunk_x\":null,\"chunk_z\":2}",
        };
        for (String body : malformed) {
            assertTrue(BlockOwnerQueries.parse(body).isEmpty(), "accepted: " + body);
        }
    }

    @Test
    void replyCarriesTheChunkBlocksAndTruncatedFlag() {
        Answer answer = new Answer("world", 1, -2,
                List.of(new OwnedBlock(16, 64, -32, "alice")), true);

        JsonObject reply = JsonParser.parseString(BlockOwnerQueries.replyJson(answer)).getAsJsonObject();

        assertEquals(List.of("world", "chunk_x", "chunk_z", "blocks", "truncated"),
                List.copyOf(reply.keySet()));
        assertEquals("world", reply.get("world").getAsString());
        assertEquals(1, reply.get("chunk_x").getAsInt());
        assertEquals(-2, reply.get("chunk_z").getAsInt());
        assertTrue(reply.get("truncated").getAsBoolean());
        JsonArray blocks = reply.getAsJsonArray("blocks");
        assertEquals(1, blocks.size());
        JsonObject block = blocks.get(0).getAsJsonObject();
        assertEquals(16, block.get("x").getAsInt());
        assertEquals(64, block.get("y").getAsInt());
        assertEquals(-32, block.get("z").getAsInt());
        assertEquals("alice", block.get("owner").getAsString());
    }

    @Test
    void emptyUnknownReplyIsTruncated() {
        Answer answer = new Answer("world", 0, 0, List.of(), true);

        JsonObject reply = JsonParser.parseString(BlockOwnerQueries.replyJson(answer)).getAsJsonObject();

        assertEquals(0, reply.getAsJsonArray("blocks").size());
        assertTrue(reply.get("truncated").getAsBoolean());
    }

    @Test
    void completeReplyIsNotTruncated() {
        Answer answer = new Answer("world", 0, 0, List.of(), false);

        JsonObject reply = JsonParser.parseString(BlockOwnerQueries.replyJson(answer)).getAsJsonObject();

        assertFalse(reply.get("truncated").getAsBoolean());
    }

    @Test
    void changedMessageCarriesNullWhenCleared() {
        JsonObject cleared = JsonParser.parseString(
                BlockOwnerQueries.changedJson(new Pos("world", 5, 70, -5), null)).getAsJsonObject();
        JsonObject placed = JsonParser.parseString(
                BlockOwnerQueries.changedJson(new Pos("world", 5, 70, -5), "bob")).getAsJsonObject();

        assertTrue(cleared.get("owner").isJsonNull());
        assertEquals("world", cleared.get("world").getAsString());
        assertEquals(5, cleared.get("x").getAsInt());
        assertEquals(70, cleared.get("y").getAsInt());
        assertEquals(-5, cleared.get("z").getAsInt());
        assertEquals("bob", placed.get("owner").getAsString());
    }
}
