package dev.geldar.identity;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * The local copy of the {@code geldar-life-registry} KV bucket: lowercase username to
 * {@code {life_id, registered_at}}. Login checks read this map and never touch NATS. It starts
 * unsynced, and the gate stays closed until a sync completes. Each (re)watch replays the whole
 * bucket into a fresh map that replaces the old one only at the end of the replay, so keys deleted
 * while the watch was down do not survive; a lost watch makes the registry unsynced again (fail closed).
 */
public final class LifeRegistry {
    /** One registered life. */
    public record Entry(String lifeId, String registeredAt) {}

    /** A Minecraft username as the proxy accepts it. */
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{1,16}");

    /** A bucket key: a username already in lowercase, so two keys never name the same player. */
    private static final Pattern CANONICAL_KEY = Pattern.compile("[a-z0-9_]{1,16}");

    private volatile Map<String, Entry> entries = new ConcurrentHashMap<>();
    /** The map being built by a replay in progress, or null. Guarded by {@code this}. */
    private Map<String, Entry> replay;
    private volatile boolean synced;

    /** True for a plain username: 1 to 16 ASCII letters, digits or underscores. */
    public static boolean isValidUsername(String username) {
        return username != null && USERNAME.matcher(username).matches();
    }

    /** The registry key for a username: lowercase, so lookups ignore case. */
    public static String key(String username) {
        return username.toLowerCase(Locale.ROOT);
    }

    /** Starts a replay of the bucket: changes go to a fresh map until {@link #markSynced}. */
    public synchronized void beginReplay() {
        replay = new ConcurrentHashMap<>();
    }

    /**
     * Applies a put. A value that is not a valid entry removes the key, so the name is denied.
     * A key that is not a canonical lowercase username is ignored: it could never be matched safely.
     */
    public synchronized void put(String key, byte[] value) {
        if (key == null || !CANONICAL_KEY.matcher(key).matches()) {
            return;
        }
        Map<String, Entry> target = replay != null ? replay : entries;
        Optional<Entry> entry = parse(value);
        if (entry.isPresent()) {
            target.put(key, entry.get());
        } else {
            target.remove(key);
        }
    }

    /** Applies a delete or purge: the life is revoked. */
    public synchronized void remove(String key) {
        if (key == null || !CANONICAL_KEY.matcher(key).matches()) {
            return;
        }
        (replay != null ? replay : entries).remove(key);
    }

    /**
     * Marks the replay of the bucket as complete: the fresh map replaces the old one and the gate may open.
     * Does nothing when no replay is in progress: a lost watch clears it, and the tail of that old watch
     * must not reopen the gate.
     */
    public synchronized void markSynced() {
        if (replay == null) {
            return;
        }
        entries = replay;
        replay = null;
        synced = true;
    }

    /** The watch was lost: deny every login until the next replay completes. */
    public synchronized void markUnsynced() {
        synced = false;
        replay = null;
    }

    public boolean isSynced() {
        return synced;
    }

    /** The registered life for this username, empty when unknown or revoked. */
    public Optional<Entry> find(String username) {
        return isValidUsername(username) ? Optional.ofNullable(entries.get(key(username))) : Optional.empty();
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
