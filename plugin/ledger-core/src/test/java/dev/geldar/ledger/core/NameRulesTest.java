package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class NameRulesTest {
    @Test
    void metricNames() {
        assertTrue(NameRules.isMetricName("geldar_tick_lag_ms"));
        assertFalse(NameRules.isMetricName("tick_lag"));
        assertFalse(NameRules.isMetricName("geldar_Tick"));
        assertFalse(NameRules.isMetricName("geldar_"));
        assertFalse(NameRules.isMetricName("geldar.tick"));
        assertFalse(NameRules.isMetricName(null));
        assertEquals("geldar_tps", NameRules.requireMetricName("geldar_tps"));
        assertThrows(IllegalArgumentException.class, () -> NameRules.requireMetricName("tick_lag"));
    }

    @Test
    void eventNames() {
        assertTrue(NameRules.isEventName("geldar.player.join"));
        assertTrue(NameRules.isEventName("geldar.trade"));
        assertFalse(NameRules.isEventName("geldar"));
        assertFalse(NameRules.isEventName("geldar.Player"));
        assertFalse(NameRules.isEventName("geldar_tps"));
        assertFalse(NameRules.isEventName("player.join"));
        assertThrows(IllegalArgumentException.class, () -> NameRules.requireEventName("geldar."));
    }

    @Test
    void everyNamesConstantPassesItsRule() throws Exception {
        List<String> metrics = new ArrayList<>();
        List<String> events = new ArrayList<>();
        for (Class<?> nested : Names.class.getDeclaredClasses()) {
            for (Field f : nested.getDeclaredFields()) {
                if (!Modifier.isStatic(f.getModifiers()) || f.getType() != String.class) {
                    continue;
                }
                String value = (String) f.get(null);
                if (nested == Names.Events.class) {
                    events.add(value);
                    assertTrue(NameRules.isEventName(value), "event " + value);
                } else {
                    metrics.add(value);
                    assertTrue(NameRules.isMetricName(value), "metric " + value);
                }
            }
        }
        assertFalse(metrics.isEmpty());
        assertFalse(events.isEmpty());
        Set<String> all = new HashSet<>(metrics);
        all.addAll(events);
        assertEquals(metrics.size() + events.size(), all.size(), "duplicate name constant");
    }
}
