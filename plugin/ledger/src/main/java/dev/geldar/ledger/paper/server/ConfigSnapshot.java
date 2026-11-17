package dev.geldar.ledger.paper.server;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Redactor;
import java.lang.management.ManagementFactory;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.Bukkit;

/**
 * The one-time {@code geldar.server.config_snapshot} payload (PT-05b). It is built from an allow-list of keys: only the
 * names in {@link #KEYS} are ever read from the source, so {@code rcon.*}, {@code query.*}, {@code server-ip},
 * {@code level-seed} and any other server.properties key can never reach the event. Each value and the final text go
 * through {@link Redactor} and {@link ContentCap} (S3 to S5).
 *
 * <p>The event sink keeps only keys of {@link AttrKeys#allowed}, and none of the configuration names is one of them, so
 * the snapshot is one {@code geldar.text} attribute of {@code name=value} pairs plus {@code geldar.collector}.
 */
final class ConfigSnapshot {
    /** The allow-list, in output order. */
    static final List<String> KEYS = List.of(
            "server_version",
            "view_distance",
            "simulation_distance",
            "max_players",
            "online_mode",
            "tick_rate",
            "jvm_xmx");

    /** The text cap of the snapshot (it is a few hundred bytes; this is a ceiling). */
    static final int MAX_TEXT_BYTES = 2048;

    private ConfigSnapshot() {}

    /** Where the raw values come from. A test passes a map that holds secrets too; only {@link #KEYS} are read. */
    interface Source {
        Map<String, String> raw();
    }

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

    /** The live server: Bukkit getters and the {@code -Xmx} flag only. It reads no file. */
    static Source live() {
        return () -> {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("server_version", String.valueOf(Bukkit.getVersion()));
            m.put("view_distance", String.valueOf(Bukkit.getViewDistance()));
            m.put("simulation_distance", String.valueOf(Bukkit.getSimulationDistance()));
            m.put("max_players", String.valueOf(Bukkit.getMaxPlayers()));
            m.put("online_mode", String.valueOf(Bukkit.getOnlineMode()));
            m.put("tick_rate", String.valueOf(Bukkit.getServerTickManager().getTickRate()));
            m.put("jvm_xmx", xmx());
            return m;
        };
    }

    private static String xmx() {
        for (String arg : ManagementFactory.getRuntimeMXBean().getInputArguments()) {
            if (arg.startsWith("-Xmx")) {
                return arg.substring(4);
            }
        }
        return Runtime.getRuntime().maxMemory() + "B";
    }
}
