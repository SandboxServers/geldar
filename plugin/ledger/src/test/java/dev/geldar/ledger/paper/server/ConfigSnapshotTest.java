package dev.geldar.ledger.paper.server;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ConfigSnapshotTest {
    static Map<String, String> propertiesWithSecrets() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("rcon.password", "hunter2");
        m.put("rcon.port", "25575");
        m.put("level-seed", "123");
        m.put("query.port", "25565");
        m.put("server-ip", "10.1.2.3");
        m.put("server_version", "1.21-test");
        m.put("view_distance", "10");
        m.put("simulation_distance", "8");
        m.put("max_players", "20");
        m.put("online_mode", "false");
        m.put("tick_rate", "20.0");
        m.put("jvm_xmx", "4G");
        return m;
    }

    @Test
    void theSnapshotCarriesTheAllowListedValuesOnly() {
        Map<String, Object> attrs = ConfigSnapshot.build(propertiesWithSecrets());
        String all = attrs.toString();
        for (String secret : new String[] {"hunter2", "25575", "123", "25565", "10.1.2.3", "rcon", "query", "seed"}) {
            assertFalse(all.contains(secret), secret + " leaked: " + all);
        }
        String text = (String) attrs.get(AttrKeys.TEXT);
        assertEquals(
                "server_version=1.21-test; view_distance=10; simulation_distance=8; max_players=20; online_mode=false;"
                        + " tick_rate=20.0; jvm_xmx=4G",
                text);
        for (String key : attrs.keySet()) {
            assertTrue(AttrKeys.allowed(key), "the sink would drop " + key);
        }
    }

    @Test
    void anUnknownKeyIsNeverReadEvenWhenItLooksHarmless() {
        Map<String, String> raw = new LinkedHashMap<>(propertiesWithSecrets());
        raw.put("motd", "hello-world-motd");
        assertFalse(ConfigSnapshot.build(raw).toString().contains("hello-world-motd"));
    }

    @Test
    void forbiddenNamesAreRefused() {
        assertTrue(ConfigSnapshot.forbidden("rcon.password"));
        assertTrue(ConfigSnapshot.forbidden("query.port"));
        assertTrue(ConfigSnapshot.forbidden("api_token"));
        for (String key : ConfigSnapshot.KEYS) {
            assertFalse(ConfigSnapshot.forbidden(key), key);
        }
    }

    @Test
    void anAddressInsideAnAllowedValueIsScrubbed() {
        Map<String, String> raw = new LinkedHashMap<>();
        raw.put("server_version", "build on 192.168.4.5 host");
        String text = (String) ConfigSnapshot.build(raw).get(AttrKeys.TEXT);
        assertFalse(text.contains("192.168.4.5"), text);
    }

    @Test
    void theTextIsCapped() {
        Map<String, String> raw = new LinkedHashMap<>();
        raw.put("server_version", "x".repeat(10_000));
        String text = (String) ConfigSnapshot.build(raw).get(AttrKeys.TEXT);
        assertTrue(text.length() <= ConfigSnapshot.MAX_TEXT_BYTES + 32, "length " + text.length());
        assertTrue(text.contains("[truncated:"));
    }
}
