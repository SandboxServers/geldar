package dev.geldar.neoforge;

import com.google.gson.JsonObject;
import dev.geldar.core.EventEnvelope;
import java.time.Instant;

/**
 * Builds the envelopes for the four exported types from plain values. The payload field names, the agent rule
 * and the subject are Paper's (EventExporter.emit in plugin/core, EventEnvelope in core-common), so a NeoForge
 * shard and a Paper shard publish the same shape. No NeoForge or Minecraft type appears here: the mapping is
 * tested without a server.
 */
public final class EventMapping {
    /** A block position in whole numbers, as the death payload writes it. */
    public record Pos(int x, int y, int z) {}

    private EventMapping() {}

    /**
     * A {@code damage} event: Paper's {@code cause} and {@code amount} fields, plus {@code player} for a life id only
     * (see {@link #build}).
     */
    public static EventEnvelope damage(
            String shard, Instant at, long tick, String player, String cause, double amount) {
        JsonObject p = new JsonObject();
        p.addProperty("cause", cause);
        p.addProperty("amount", amount);
        return build(shard, at, tick, "damage", player, p);
    }

    /**
     * A {@code death} event: the cause, the death block, the dimension. Drops and the respawn point are not written
     * on NeoForge yet (README, Events); the schema allows them absent. A null position is absent too.
     */
    public static EventEnvelope death(
            String shard, Instant at, long tick, String player, String cause, Pos where, String dimensionId) {
        JsonObject p = new JsonObject();
        p.addProperty("cause", cause == null ? "UNKNOWN" : cause);
        if (where != null) {
            p.addProperty("x", where.x());
            p.addProperty("y", where.y());
            p.addProperty("z", where.z());
        }
        p.addProperty("dimension", dimensionOf(dimensionId));
        return build(shard, at, tick, "death", player, p);
    }

    /** A {@code sleep} event: the player only, as on Paper. */
    public static EventEnvelope sleep(String shard, Instant at, long tick, String player) {
        return build(shard, at, tick, "sleep", player, new JsonObject());
    }

    /**
     * A {@code server_tps} event with Paper's payload fields. The {@code tps} value is derived from tick time on
     * NeoForge (see {@link TickWindow}), not Bukkit's TPS. No payload schema exists for this type in contract/.
     */
    public static EventEnvelope serverTps(
            String shard, Instant at, long tick, double tps, int players, long dropped, boolean connected) {
        JsonObject p = new JsonObject();
        p.addProperty("tps", tps);
        p.addProperty("players", players);
        p.addProperty("dropped", dropped);
        p.addProperty("connected", connected);
        return build(shard, at, tick, "server_tps", null, p);
    }

    /**
     * Adds {@code player} and sets the agent id only for a life id, as Paper's emit does. A name that is not a life id
     * is a human's (the NeoForge shard is human-directed): its name is never exported, so the payload carries no
     * {@code player} field and the agent id stays null. The event itself is still written.
     */
    static EventEnvelope build(
            String shard, Instant at, long tick, String type, String player, JsonObject payload) {
        if (EventEnvelope.isLifeId(player)) {
            payload.addProperty("player", player);
        }
        String agentId = EventEnvelope.isLifeId(player) ? player : null;
        return EventEnvelope.create(at, shard, tick, type, agentId, payload);
    }

    /**
     * The contract's dimension words for a dimension id such as {@code minecraft:the_nether}. A custom or missing
     * dimension reads as {@code other}, as Paper's dimension() does.
     */
    public static String dimensionOf(String dimensionId) {
        if (dimensionId == null) {
            return "other";
        }
        return switch (dimensionId) {
            case "minecraft:overworld" -> "overworld";
            case "minecraft:the_nether" -> "nether";
            case "minecraft:the_end" -> "end";
            default -> "other";
        };
    }

    /**
     * A Bukkit DamageCause name for a vanilla damage type's message id (for example {@code fall} is FALL). The
     * table is a best effort; an id it does not know reads as CUSTOM, the same catch-all Bukkit uses.
     */
    public static String causeOf(String msgId) {
        if (msgId == null) {
            return "CUSTOM";
        }
        return switch (msgId) {
            case "player", "mob", "sting" -> "ENTITY_ATTACK";
            case "fall" -> "FALL";
            case "inFire" -> "FIRE";
            case "onFire" -> "FIRE_TICK";
            case "lava" -> "LAVA";
            case "drown" -> "DROWNING";
            case "starve" -> "STARVATION";
            case "cactus", "sweetBerryBush" -> "CONTACT";
            case "inWall" -> "SUFFOCATION";
            case "outOfWorld" -> "VOID";
            case "arrow", "trident" -> "PROJECTILE";
            case "explosion", "explosion.player" -> "ENTITY_EXPLOSION";
            case "magic" -> "MAGIC";
            case "wither" -> "WITHER";
            case "dragonBreath" -> "DRAGON_BREATH";
            case "lightningBolt" -> "LIGHTNING";
            case "anvil", "fallingBlock" -> "FALLING_BLOCK";
            case "freeze" -> "FREEZE";
            case "thorns" -> "THORNS";
            case "hotFloor" -> "HOT_FLOOR";
            case "cramming" -> "CRAMMING";
            case "dryout" -> "DRYOUT";
            default -> "CUSTOM";
        };
    }
}
