package dev.geldar.ledger.core;

import java.util.Set;

/**
 * The attribute allow-list. {@link #allowed} governs event and content attributes (anything else is dropped by the
 * binding). {@link #metricAllowed} governs metric attributes: only the bare low-cardinality keys of the frozen metric
 * names (README section 4) are accepted; every {@code geldar.*} key is refused (S7).
 */
public final class AttrKeys {
    public static final String LIFE_ID = "geldar.life_id";
    public static final String PLAYER_UUID = "minecraft.player.uuid";
    public static final String WORLD = "geldar.world";
    public static final String WORLD_TICK = "geldar.world_tick";
    public static final String SERVER_TICK = "geldar.server_tick";
    public static final String MC_SESSION = "geldar.mc_session";
    public static final String EVENT_CLASS = "geldar.event.class";
    public static final String CANCELLED = "geldar.cancelled";
    public static final String COLLECTOR = "geldar.collector";
    public static final String QUEUE = "geldar.queue";
    public static final String CAUSE = "geldar.cause";
    public static final String RESULT = "geldar.result";
    public static final String X = "geldar.x";
    public static final String Y = "geldar.y";
    public static final String Z = "geldar.z";
    public static final String ITEM = "geldar.item";
    public static final String BLOCK = "geldar.block";
    public static final String CONTAINER_TYPE = "geldar.container_type";
    public static final String AMOUNT = "geldar.amount";
    public static final String TEXT = "geldar.text";
    public static final String COMMAND = "geldar.command";
    public static final String EXCEPTION_CLASS = "geldar.exception.class";
    public static final String PLUGIN = "geldar.plugin";
    public static final String DURATION_MS = "geldar.duration_ms";
    /** Consecutive overrun count on {@code geldar.server.slow_tick} (PT-04b). */
    public static final String TICK_OVERRUNS = "geldar.tick_overruns";
    // Player snapshot fields (PT-08b): event keys only, never metric attributes.
    public static final String HEALTH = "geldar.health";
    public static final String FOOD = "geldar.food";
    public static final String XP_LEVEL = "geldar.xp_level";
    public static final String GAMEMODE = "geldar.gamemode";
    public static final String PING_BUCKET = "geldar.ping_bucket";
    // Dedicated keys (event keys only, never metric attributes): replace borrowing geldar.result / geldar.cause.
    /** String: enum-like subtype (villager profession key, animal or killed EntityType, fish state). */
    public static final String SUBTYPE = "geldar.subtype";
    /** Long: the damage role code, 1 victim, 2 attacker, 3 pvp. */
    public static final String ROLE = "geldar.role";
    /** Long: a 0/1 flag, such as the operator teleport flag. */
    public static final String FLAG = "geldar.flag";

    private static final Set<String> ALLOWED = Set.of(
            LIFE_ID, PLAYER_UUID, WORLD, WORLD_TICK, SERVER_TICK, MC_SESSION, EVENT_CLASS, CANCELLED, COLLECTOR, QUEUE,
            CAUSE, RESULT, X, Y, Z, ITEM, BLOCK, CONTAINER_TYPE, AMOUNT, TEXT, COMMAND, EXCEPTION_CLASS, PLUGIN,
            DURATION_MS, TICK_OVERRUNS, HEALTH, FOOD, XP_LEVEL, GAMEMODE, PING_BUCKET,
            SUBTYPE, ROLE, FLAG);

    // Metric attribute keys: BARE, as in the README section 4 metric table (decision 2026-11-17). The prefixed
    // geldar.* keys above are for events and logs only.
    public static final String M_WINDOW = "window";
    public static final String M_STAT = "stat";
    public static final String M_SCOPE = "scope";
    public static final String M_GC = "gc";
    public static final String M_GROUP = "group";
    public static final String M_CLASS_GROUP = "class_group";
    public static final String M_OP = "op";
    public static final String M_KIND = "kind";
    public static final String M_AREA = "area";
    public static final String M_WORLD = "world";
    public static final String M_QUEUE = "queue";
    public static final String M_COLLECTOR = "collector";
    public static final String M_EVENT_CLASS = "event_class";
    public static final String M_CANCELLED = "cancelled";

    /**
     * Exactly the bare metric attribute keys. Every {@code geldar.*} key (including per-player, per-session, free text,
     * coordinates, ticks, amounts, durations, exception classes) is refused as a metric attribute (S7).
     */
    private static final Set<String> METRIC_ONLY = Set.of(
            M_WINDOW, M_STAT, M_SCOPE, M_GC, M_GROUP, M_CLASS_GROUP, M_OP, M_KIND, M_AREA, M_WORLD, M_QUEUE,
            M_COLLECTOR, M_EVENT_CLASS, M_CANCELLED);

    private AttrKeys() {}

    /** True when the key may appear on an event or content record. */
    public static boolean allowed(String key) {
        return key != null && ALLOWED.contains(key);
    }

    /** True when the key may be a metric attribute: exactly the bare keys of the README section 4 metric table. */
    public static boolean metricAllowed(String key) {
        return key != null && METRIC_ONLY.contains(key);
    }
}
