package dev.geldar.core.blockowner;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.geldar.core.blockowner.OwnerQueryService.Answer;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import java.util.Optional;
import java.util.Set;

/**
 * The JSON of blockowner.query, its reply and blockowner.changed, as block-owner.schema.json describes it.
 * {@link #parse} accepts only a query that matches the schema exactly and returns empty for anything else, so a
 * malformed request is ignored without a reply.
 */
final class BlockOwnerQueries {
    private static final Set<String> KEYS = Set.of("world", "chunk_x", "chunk_z");
    private static final int CHUNK_LIMIT = 1_875_000;
    private static final int WORLD_MAX = 64;

    /** A query for one chunk. */
    record Query(String world, int chunkX, int chunkZ) {}

    private BlockOwnerQueries() {}

    static Optional<Query> parse(String json) {
        if (json == null) {
            return Optional.empty();
        }
        try {
            JsonElement root = JsonParser.parseString(json);
            if (!root.isJsonObject()) {
                return Optional.empty();
            }
            JsonObject o = root.getAsJsonObject();
            if (!o.keySet().equals(KEYS)) {
                return Optional.empty();
            }
            JsonElement world = o.get("world");
            if (!isString(world) || world.getAsString().isEmpty() || world.getAsString().length() > WORLD_MAX) {
                return Optional.empty();
            }
            Optional<Integer> cx = chunkCoordinate(o.get("chunk_x"));
            Optional<Integer> cz = chunkCoordinate(o.get("chunk_z"));
            if (cx.isEmpty() || cz.isEmpty()) {
                return Optional.empty();
            }
            return Optional.of(new Query(world.getAsString(), cx.get(), cz.get()));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    static String replyJson(Answer answer) {
        JsonObject o = new JsonObject();
        o.addProperty("world", answer.world());
        o.addProperty("chunk_x", answer.chunkX());
        o.addProperty("chunk_z", answer.chunkZ());
        JsonArray blocks = new JsonArray();
        for (OwnedBlock b : answer.blocks()) {
            JsonObject entry = new JsonObject();
            entry.addProperty("x", b.x());
            entry.addProperty("y", b.y());
            entry.addProperty("z", b.z());
            entry.addProperty("owner", b.owner());
            blocks.add(entry);
        }
        o.add("blocks", blocks);
        o.addProperty("truncated", answer.truncated());
        return o.toString();
    }

    static String changedJson(OwnerCache.Pos p, String owner) {
        JsonObject o = new JsonObject();
        o.addProperty("world", p.world());
        o.addProperty("x", p.x());
        o.addProperty("y", p.y());
        o.addProperty("z", p.z());
        o.add("owner", owner == null ? JsonNull.INSTANCE : new JsonPrimitive(owner));
        return o.toString();
    }

    private static boolean isString(JsonElement e) {
        return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isString();
    }

    private static Optional<Integer> chunkCoordinate(JsonElement e) {
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) {
            return Optional.empty();
        }
        double d = e.getAsDouble();
        if (d != Math.rint(d) || d < -CHUNK_LIMIT || d > CHUNK_LIMIT) {
            return Optional.empty();
        }
        return Optional.of((int) d);
    }
}
