package dev.geldar.core;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.regex.Pattern;

/**
 * One world event in the shape of contract/schemas/event.schema.json.
 *
 * <p>{@code agentId} is null when the event does not concern an agent life.
 */
public record EventEnvelope(
        String sourceEventId,
        Instant at,
        String shard,
        long worldDay,
        long worldTick,
        String type,
        String agentId,
        JsonObject payload) {

    private static final Pattern LIFE_ID = Pattern.compile("^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$");

    /** True when the name is a life id such as {@code ag_kestrel_01}. */
    public static boolean isLifeId(String name) {
        return name != null && LIFE_ID.matcher(name).matches();
    }

    /** Builds an envelope with a fresh {@code ev_} id taken from the event's own timestamp. */
    public static EventEnvelope create(
            Instant at, String shard, long worldTick, String type, String agentId, JsonObject payload) {
        String id = "ev_" + Ulid.generate(at.toEpochMilli());
        return new EventEnvelope(id, at, shard, worldTick / 24000, worldTick, type, agentId, payload);
    }

    /** The NATS subject, {@code geldar.<shard>.<type>}. */
    public String subject() {
        return "geldar." + shard + "." + type;
    }

    /** The JSON object matching the event schema. */
    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("source_event_id", sourceEventId);
        o.addProperty("at", at.toString());
        o.addProperty("shard", shard);
        o.addProperty("world_day", worldDay);
        o.addProperty("world_tick", worldTick);
        o.addProperty("type", type);
        if (agentId != null) {
            o.addProperty("agent_id", agentId);
        }
        o.add("payload", payload);
        return o;
    }

    /** The UTF-8 JSON body published on NATS. */
    public byte[] toBytes() {
        return toJson().toString().getBytes(StandardCharsets.UTF_8);
    }
}