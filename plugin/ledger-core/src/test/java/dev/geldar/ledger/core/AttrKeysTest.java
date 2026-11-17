package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AttrKeysTest {
    @Test
    void allowList() {
        assertTrue(AttrKeys.allowed("minecraft.player.uuid"));
        assertTrue(AttrKeys.allowed("geldar.life_id"));
        assertFalse(AttrKeys.allowed("password"));
        assertFalse(AttrKeys.allowed("rcon.password"));
        assertFalse(AttrKeys.allowed(null));
    }

    /** README section 4 "Attribute keys", frozen. */
    private static final List<String> README_ALLOWED = List.of(
            "geldar.life_id", "minecraft.player.uuid", "geldar.world", "geldar.world_tick", "geldar.server_tick",
            "geldar.mc_session", "geldar.event.class", "geldar.cancelled", "geldar.collector", "geldar.queue",
            "geldar.cause", "geldar.result", "geldar.x", "geldar.y", "geldar.z", "geldar.item", "geldar.block",
            "geldar.container_type", "geldar.amount", "geldar.text", "geldar.command", "geldar.exception.class",
            "geldar.plugin", "geldar.duration_ms", "geldar.tick_overruns",
            "geldar.health", "geldar.food", "geldar.xp_level", "geldar.gamemode", "geldar.ping_bucket");

    /** README section 4 metric table attributes, bare (decision 2026-11-17), frozen. */
    private static final List<String> README_METRIC = List.of(
            "window", "stat", "scope", "gc", "group", "class_group", "op", "kind", "area", "world", "queue",
            "collector", "event_class", "cancelled");

    @Test
    void everyReadmeAllowedKeyIsAllowedAndNothingElseIsChecked() {
        assertEquals(30, README_ALLOWED.size());
        for (String key : README_ALLOWED) {
            assertTrue(AttrKeys.allowed(key), key);
        }
        for (String not : List.of("window", "geldar.world ", " geldar.world", "geldar.Cause", "geldar.", "", "geldar.speed")) {
            assertFalse(AttrKeys.allowed(not), not);
        }
    }

    @Test
    void allowListConstantsMatchTheReadmeExactly() throws IllegalAccessException {
        java.util.Set<String> constants = new java.util.HashSet<>();
        for (java.lang.reflect.Field f : AttrKeys.class.getFields()) {
            if (f.getType() == String.class && !f.getName().startsWith("M_")) {
                constants.add((String) f.get(null));
            }
        }
        assertEquals(new java.util.HashSet<>(README_ALLOWED), constants);
    }

    @Test
    void metricAllowedIsExactlyTheBareKeys() throws IllegalAccessException {
        for (String key : README_METRIC) {
            assertTrue(AttrKeys.metricAllowed(key), key);
        }
        java.util.Set<String> bare = new java.util.HashSet<>();
        for (java.lang.reflect.Field f : AttrKeys.class.getFields()) {
            if (f.getName().startsWith("M_")) {
                bare.add((String) f.get(null));
            }
        }
        assertEquals(new java.util.HashSet<>(README_METRIC), bare);
        assertFalse(AttrKeys.metricAllowed("password"));
        assertFalse(AttrKeys.metricAllowed(null));
        assertFalse(AttrKeys.metricAllowed("world "));
    }

    @Test
    void everyPrefixedAndPerPlayerKeyIsRefusedAsAMetricAttribute() {
        for (String key : README_ALLOWED) {
            assertFalse(AttrKeys.metricAllowed(key), key);
        }
        for (String key : List.of("geldar.server_tick", "geldar.world_tick", "geldar.amount", "geldar.duration_ms",
                "geldar.exception.class", "geldar.life_id", "geldar.event.class", "geldar.cancelled", "geldar.world",
                "geldar.queue", "geldar.collector", "geldar.anything_else")) {
            assertFalse(AttrKeys.metricAllowed(key), key);
        }
    }

    @Test
    void attrsAreImmutableAndNullChecked() {
        Attrs base = Attrs.of().str("a", "x");
        Attrs more = base.lng("n", 3).dbl("d", 1.5).bool("b", true);
        assertEquals(Map.of("a", "x"), base.build());
        assertEquals(4, more.build().size());
        assertEquals(3L, more.build().get("n"));
        assertEquals(true, more.build().get("b"));
        assertThrows(UnsupportedOperationException.class, () -> more.build().put("z", 1));
        assertThrows(NullPointerException.class, () -> base.str("k", null));
        assertThrows(NullPointerException.class, () -> base.str(null, "v"));
    }
}
