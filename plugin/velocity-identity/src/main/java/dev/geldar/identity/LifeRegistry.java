package dev.geldar.identity;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * The local copy of the {@code geldar-life-registry} KV bucket: lowercase username to
 * {@code {life_id, registered_at}}. Login checks read this map and never touch NATS. It starts
 * unsynced, and the gate stays closed until a sync completes. Each (re)watch replays the whole
 * bucket into a fresh map that replaces the old one only at the end of the replay, so keys deleted
 * while the watch was down do not survive; a lost watch makes the registry unsynced again (fail closed).
 * NATS expires a key by TTL without sending a delete to watchers, so each entry also records when it was
 * last received, and {@link #find} treats an entry older than the maximum age as absent.
 */
public class LifeRegistry implements RegistryClient.Feed {
    /**
     * One registered life. {@code live} is false for a ghost (a registered name whose life is not live); an entry
     * without the {@code live} field is live, so the writers that predate the field keep their meaning.
     */
    public record Entry(String lifeId, String registeredAt, boolean live) {
        public Entry(String lifeId, String registeredAt) {
            this(lifeId, registeredAt, true);
        }
    }

    /**
     * The longest an entry stays admissible after it was last received. The bucket's TTL is 60 s and the
     * Body rewrites its key every 20 s, so a live key is always received again well inside this age.
     */
    public static final Duration DEFAULT_MAX_AGE = Duration.ofSeconds(90);

    /** A Minecraft username as the proxy accepts it. */
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_]{1,16}");

    /** A bucket key: a username already in lowercase, so two keys never name the same player. */
    private static final Pattern CANONICAL_KEY = Pattern.compile("[a-z0-9_]{1,16}");

    /** An entry with the local nanotime it was last received (a put, or a replay that ended with it). */
    private record Stamped(Entry entry, long receivedAtNanos) {}

    private final LongSupplier clock;
    private final long maxAgeNanos;
    private volatile Map<String, Stamped> entries = new ConcurrentHashMap<>();
    /** The map being built by a replay in progress, or null. Guarded by {@code this}. */
    private Map<String, Stamped> replay;
    private volatile boolean synced;

    public LifeRegistry() {
        this(System::nanoTime, DEFAULT_MAX_AGE);
    }

    /** A registry with its own clock and maximum entry age (a fake clock in tests). */
    LifeRegistry(LongSupplier clock, Duration maxAge) {
        this.clock = clock;
        this.maxAgeNanos = maxAge.toNanos();
    }

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
        Map<String, Stamped> target = replay != null ? replay : entries;
        Optional<Entry> entry = parse(value);
        if (entry.isPresent()) {
            target.put(key, new Stamped(entry.get(), clock.getAsLong()));
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

    /**
     * The registered life for this username, empty when unknown, revoked, or not received within the maximum
     * age (its TTL has run out on the bucket, and no delete came).
     */
    public Optional<Entry> find(String username) {
        if (!isValidUsername(username)) {
            return Optional.empty();
        }
        Stamped stamped = entries.get(key(username));
        if (stamped == null || clock.getAsLong() - stamped.receivedAtNanos() > maxAgeNanos) {
            return Optional.empty();
        }
        return Optional.of(stamped.entry());
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
            boolean live = true;
            JsonElement flag = object.get("live");
            if (flag != null) {
                // A present flag must be a JSON boolean; anything else fails closed (the name is denied).
                if (!flag.isJsonPrimitive() || !flag.getAsJsonPrimitive().isBoolean()) {
                    return Optional.empty();
                }
                live = flag.getAsBoolean();
            }
            return Optional.of(new Entry(lifeId, registeredAt, live));
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
