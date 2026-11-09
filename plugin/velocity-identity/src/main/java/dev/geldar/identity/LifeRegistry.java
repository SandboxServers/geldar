package dev.geldar.identity;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The local copy of the {@code geldar-life-registry} KV bucket: lowercase username to
 * {@code {life_id, registered_at}}. Login checks read this map and never touch NATS. It starts
 * unsynced, and the gate stays closed until the first sync completes.
 */
public final class LifeRegistry {
    /** One registered life. */
    public record Entry(String lifeId, String registeredAt) {}

    private final ConcurrentHashMap<String, Entry> entries = new ConcurrentHashMap<>();
    private volatile boolean synced;

    /** The registry key for a username: lowercase, so lookups ignore case. */
    public static String key(String username) {
        return username.toLowerCase(Locale.ROOT);
    }

    /** Applies a put. A value that is not a valid entry removes the key, so the name is denied. */
    public void put(String key, byte[] value) {
        Optional<Entry> entry = parse(value);
        if (entry.isPresent()) {
            entries.put(key(key), entry.get());
        } else {
            entries.remove(key(key));
        }
    }

    /** Applies a delete or purge: the life is revoked. */
    public void remove(String key) {
        entries.remove(key(key));
    }

    /** Marks the initial replay of the bucket as complete. */
    public void markSynced() {
        synced = true;
    }

    public boolean isSynced() {
        return synced;
    }

    /** The registered life for this username, empty when unknown or revoked. */
    public Optional<Entry> find(String username) {
        return Optional.ofNullable(entries.get(key(username)));
    }

    /** Parses {@code {"life_id": "...", "registered_at": "..."}}; both fields must be non-empty strings. */
    static Optional<Entry> parse(byte[] value) {
        if (value == null || value.length == 0) {
            return Optional.empty();
        }
        try {
            JsonElement root = JsonParser.parseString(new String(value, StandardCharsets.UTF_8));
            if (!root.isJsonObject()) {
                return Optional.empty();
            }
            JsonObject object = root.getAsJsonObject();
            String lifeId = text(object, "life_id");
            String registeredAt = text(object, "registered_at");
            if (lifeId == null || registeredAt == null) {
                return Optional.empty();
            }
            return Optional.of(new Entry(lifeId, registeredAt));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static String text(JsonObject object, String field) {
        JsonElement element = object.get(field);
        if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
            return null;
        }
        String text = element.getAsString();
        return text.isBlank() ? null : text;
    }
}
