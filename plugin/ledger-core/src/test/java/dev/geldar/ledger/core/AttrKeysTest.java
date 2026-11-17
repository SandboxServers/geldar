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

    @Test
    void perPlayerAndFreeTextKeysAreNeverMetricAttributes() {
        for (String key : List.of(
                "geldar.life_id", "minecraft.player.uuid", "geldar.mc_session", "geldar.text", "geldar.command",
                "geldar.x", "geldar.y", "geldar.z")) {
            assertFalse(AttrKeys.metricAllowed(key), key);
        }
    }

    @Test
    void lowCardinalityMetricKeys() {
        for (String key : List.of(
                "geldar.world", "geldar.event.class", "geldar.cancelled", "geldar.collector", "geldar.queue", "window",
                "stat", "scope", "gc", "group", "class_group", "op", "kind", "area")) {
            assertTrue(AttrKeys.metricAllowed(key), key);
        }
        assertFalse(AttrKeys.metricAllowed("password"));
        assertFalse(AttrKeys.metricAllowed(null));
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
