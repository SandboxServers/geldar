package dev.geldar.ledger.core;

import java.util.Set;

/**
 * The attribute allow-list. {@link #allowed} governs event and content attributes (anything else is dropped by the
 * binding). {@link #metricAllowed} governs metric attributes: per-player and high-cardinality keys are refused (S7),
 * and the short low-cardinality keys of the frozen metric names (README section 4) are accepted.
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

    private static final Set<String> ALLOWED = Set.of(
            LIFE_ID, PLAYER_UUID, WORLD, WORLD_TICK, SERVER_TICK, MC_SESSION, EVENT_CLASS, CANCELLED, COLLECTOR, QUEUE,
            CAUSE, RESULT, X, Y, Z, ITEM, BLOCK, CONTAINER_TYPE, AMOUNT, TEXT, COMMAND, EXCEPTION_CLASS, PLUGIN,
            DURATION_MS);

    /** Never a metric attribute (S7): per-player, per-session, free text and coordinates. */
    private static final Set<String> NOT_METRIC =
            Set.of(LIFE_ID, PLAYER_UUID, MC_SESSION, TEXT, COMMAND, X, Y, Z);

    /** Low-cardinality keys used as metric attributes by README section 4 (window, stat, gc, ...). */
    private static final Set<String> METRIC_ONLY = Set.of(
            "window", "stat", "scope", "gc", "group", "class_group", "op", "kind", "area", "world", "queue",
            "collector");

    private AttrKeys() {}

    /** True when the key may appear on an event or content record. */
    public static boolean allowed(String key) {
        return key != null && ALLOWED.contains(key);
    }

    /** True when the key may be a metric attribute. */
    public static boolean metricAllowed(String key) {
        if (key == null || NOT_METRIC.contains(key)) {
            return false;
        }
        return ALLOWED.contains(key) || METRIC_ONLY.contains(key);
    }
}
