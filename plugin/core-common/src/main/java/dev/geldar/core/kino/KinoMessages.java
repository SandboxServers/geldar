package dev.geldar.core.kino;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;

/** Builds the kino-feed messages as JSON text. Names only: no textures, no player names, no addresses. */
public final class KinoMessages {
    public static final int MAX_ENTITIES = 256;

    private KinoMessages() {}

    public static String hello(String world, String agentId, int radius) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "hello");
        o.addProperty("feed_version", 1);
        o.addProperty("world", world);
        o.addProperty("target_agent_id", agentId);
        o.addProperty("view_radius", radius);
        return o.toString();
    }

    public static String chunkSection(int cx, int cz, int sy, PaletteEncoder.Encoded e) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "chunk_section");
        o.addProperty("chunk_x", cx);
        o.addProperty("chunk_z", cz);
        o.addProperty("section_y", sy);
        JsonArray palette = new JsonArray();
        e.palette().forEach(palette::add);
        o.add("palette", palette);
        o.addProperty("bits", e.bits());
        o.addProperty("data", e.data());
        return o.toString();
    }

    public static String blockUpdate(int x, int y, int z, String state) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "block_update");
        JsonObject pos = new JsonObject();
        pos.addProperty("x", x);
        pos.addProperty("y", y);
        pos.addProperty("z", z);
        o.add("pos", pos);
        o.addProperty("state", PaletteEncoder.normalize(state));
        return o.toString();
    }

    /** At most {@link #MAX_ENTITIES} entries; ids are opaque, feed-scoped and not UUIDs. */
    public static String entityPositions(List<KinoWorld.EntityView> entities) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "entity_positions");
        JsonArray list = new JsonArray();
        for (int i = 0; i < Math.min(MAX_ENTITIES, entities.size()); i++) {
            KinoWorld.EntityView v = entities.get(i);
            JsonObject e = new JsonObject();
            e.addProperty("id", "e" + (v.uid() != 0 ? v.uid() : i));
            e.addProperty("type", v.type());
            if (v.agentId() != null) {
                e.addProperty("agent_id", v.agentId());
            }
            e.addProperty("x", v.x());
            e.addProperty("y", v.y());
            e.addProperty("z", v.z());
            e.addProperty("yaw", v.yaw());
            e.addProperty("pitch", Math.max(-90f, Math.min(90f, v.pitch())));
            list.add(e);
        }
        o.add("entities", list);
        return o.toString();
    }

    public static String targetMoved(String agentId, double x, double y, double z) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "target_moved");
        o.addProperty("target_agent_id", agentId);
        o.addProperty("x", x);
        o.addProperty("y", y);
        o.addProperty("z", z);
        return o.toString();
    }

    public static String bye(String reason) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "bye");
        o.addProperty("reason", reason);
        return o.toString();
    }
}