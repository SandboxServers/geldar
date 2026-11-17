package dev.geldar.ledger.neoforge.server;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Redactor;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The one-time {@code geldar.server.config_snapshot} payload. Built from an allow-list of keys: only the names in
 * {@link #KEYS} are ever read from the source, so {@code rcon.*}, {@code query.*}, {@code server-ip}, {@code level-seed}
 * and any other server.properties key can never reach the event. Each value and the final text go through
 * {@link Redactor} and {@link ContentCap}. The result is one {@code geldar.text} attribute of {@code name=value} pairs
 * plus {@code geldar.collector} (same shape as Paper's).
 */
final class ConfigSnapshot {
    /** The allow-list, in output order. */
    static final List<String> KEYS =
            List.of("server_version", "view_distance", "simulation_distance", "max_players", "online_mode", "jvm_xmx");

    static final int MAX_TEXT_BYTES = 2048;

    private ConfigSnapshot() {}

    /** True for a name the snapshot must never carry. Defence in depth: the allow-list already excludes them. */
    static boolean forbidden(String key) {
        String k = key.toLowerCase(Locale.ROOT);
        return k.startsWith("rcon") || k.startsWith("query") || Redactor.keyIsCredential(key);
    }

    /** The event attributes for the raw values: allow-listed keys only, redacted and capped. */
    static Map<String, Object> build(Map<String, String> raw) {
        StringBuilder text = new StringBuilder();
        for (String key : KEYS) {
            String value = raw.get(key);
            if (value == null || forbidden(key)) {
                continue;
            }
            if (text.length() > 0) {
                text.append("; ");
            }
            text.append(key).append('=').append(Redactor.scrub(value));
        }
        Map<String, Object> attrs = new LinkedHashMap<>();
        attrs.put(AttrKeys.COLLECTOR, ServerCollector.ID);
        attrs.put(AttrKeys.TEXT, Redactor.scrub(ContentCap.cap(text.toString(), MAX_TEXT_BYTES)));
        return attrs;
    }
}