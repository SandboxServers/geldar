package dev.geldar.core.maintenance;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The plugin side of maintenance-notice.schema.json (CD-1): one notice from the deploy on
 * {@code geldar.<shard>.maintenance}. {@link #parse} checks the payload against the schema and returns empty for
 * anything that does not match (unknown keys, bad values, not JSON); {@link #line} is the server line for it, or
 * empty when the notice says nothing to players.
 */
public record MaintenanceNotice(String id, String kind, String scope, Integer seconds) {
    private static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");
    private static final Set<String> KEYS = Set.of("id", "kind", "scope", "seconds", "reason");
    private static final Set<String> KINDS = Set.of("pause", "restart", "back");
    private static final Set<String> SCOPES = Set.of("bodies", "world", "mcp");
    private static final Set<String> REASONS = Set.of("update", "plugin_update", "config");
    private static final int MAX_SECONDS = 600;

    /** Parses and validates one notice; empty when the payload is not a valid notice. Never throws. */
    public static Optional<MaintenanceNotice> parse(String json) {
        try {
            JsonObject o = JsonParser.parseString(json).getAsJsonObject();
            if (!KEYS.containsAll(o.keySet())) {
                return Optional.empty();
            }
            String id = text(o, "id");
            String kind = text(o, "kind");
            String scope = text(o, "scope");
            if (id == null || kind == null || scope == null
                    || !ID.matcher(id).matches() || !KINDS.contains(kind) || !SCOPES.contains(scope)) {
                return Optional.empty();
            }
            String reason = text(o, "reason");
            if (o.has("reason") && (reason == null || !REASONS.contains(reason))) {
                return Optional.empty();
            }
            Integer seconds = null;
            if (o.has("seconds")) {
                JsonElement e = o.get("seconds");
                if (!e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) {
                    return Optional.empty();
                }
                double d = e.getAsDouble();
                if (d != Math.rint(d) || d < 0 || d > MAX_SECONDS) {
                    return Optional.empty();
                }
                seconds = (int) d;
            }
            return Optional.of(new MaintenanceNotice(id, kind, scope, seconds));
        } catch (RuntimeException e) {
            // Not JSON, not an object, or a value of the wrong type: ignored.
            return Optional.empty();
        }
    }

    /** A string member, or null when it is absent or not a JSON string. */
    private static String text(JsonObject o, String key) {
        JsonElement e = o.get(key);
        if (e instanceof JsonPrimitive p && p.isString()) {
            return p.getAsString();
        }
        return null;
    }

    /**
     * The server line for this notice, or empty when players are told nothing. A world pause or restart counts down
     * (or says "soon" when there is no countdown); a pause of bodies or the MCP warns of brief drops; a back says
     * the maintenance is over. Restart of bodies or the MCP is silent: the pause line already covered it.
     */
    public Optional<String> line() {
        return switch (kind) {
            case "back" -> Optional.of("Server maintenance finished.");
            case "pause", "restart" -> {
                if (scope.equals("world")) {
                    String countdown = seconds == null
                            ? "Server maintenance soon."
                            : "Server maintenance in " + seconds + " seconds.";
                    yield Optional.of(countdown);
                }
                yield kind.equals("pause")
                        ? Optional.of("Brief maintenance: some players may drop and return.")
                        : Optional.empty();
            }
            default -> Optional.empty();
        };
    }
}
