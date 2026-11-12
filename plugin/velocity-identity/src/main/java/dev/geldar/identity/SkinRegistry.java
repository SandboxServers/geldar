package dev.geldar.identity;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;

/**
 * The local copy of the {@code geldar-skins} KV bucket written by {@code tools/players-cli skin set}: life id to the
 * signed Mojang texture of that life's skin. A record is {@code {life_id, value, signature, model, set_at}}; the
 * plugin reads {@code value} and {@code signature} only. A record is kept only when its life id is its key and its
 * value decodes to a texture URL on the Mojang texture host. It starts unsynced and answers nothing until a replay
 * completes, so a missing bucket or a dead NATS means no skin (fail open to the default profile).
 */
public class SkinRegistry implements RegistryClient.Feed {
    public static final String BUCKET = "geldar-skins";
    /** The only host a signed skin texture may point at. */
    static final String TEXTURE_HOST = "textures.minecraft.net";
    private static final int MAX_LIFE_ID_CHARS = 64;
    private static final int MAX_VALUE_CHARS = 16_384;
    private static final int MAX_SIGNATURE_CHARS = 4_096;

    /** A signed texture as the profile property takes it. The value is kept out of {@code toString}. */
    public record Texture(String value, String signature, String variant) {
        public Texture(String value, String signature) {
            this(value, signature, "classic");
        }

        @Override
        public String toString() {
            return "Texture[redacted]";
        }
    }

    private final Logger log;
    private volatile Map<String, Texture> textures = new ConcurrentHashMap<>();
    /** The map being built by a replay in progress, or null. Guarded by {@code this}. */
    private Map<String, Texture> replay;
    private volatile boolean synced;
    /** Life id to the fixed reason its record was rejected; entries leave on a good put or a delete. */
    private final Map<String, String> rejected = new ConcurrentHashMap<>();

    public SkinRegistry(Logger log) {
        this.log = log;
    }

    @Override
    public synchronized void beginReplay() {
        replay = new ConcurrentHashMap<>();
    }

    /** Applies a put. A record that fails validation removes the key, so no stale skin survives it. */
    @Override
    public synchronized void put(String key, byte[] value) {
        if (key == null || key.isBlank()) {
            return;
        }
        Map<String, Texture> target = replay != null ? replay : textures;
        Parsed parsed = check(key, value);
        if (parsed.texture() != null) {
            target.put(key, parsed.texture());
            rejected.remove(key);
        } else {
            target.remove(key);
            rejected.put(key, parsed.reason());
            // Only the key and a fixed reason are logged, never the record.
            log.warn("skin: record for {} rejected: {}", IdentityPlugin.printable(key), parsed.reason());
        }
    }

    /** Applies a delete or purge: the skin is removed. */
    @Override
    public synchronized void remove(String key) {
        if (key != null) {
            rejected.remove(key);
            (replay != null ? replay : textures).remove(key);
        }
    }

    @Override
    public synchronized void markSynced() {
        if (replay == null) {
            return;
        }
        textures = replay;
        replay = null;
        synced = true;
        log.info("skin: bucket {} synced, {} keys cached, {} rejected", BUCKET, textures.size(), rejected.size());
    }

    @Override
    public synchronized void markUnsynced() {
        synced = false;
        replay = null;
    }

    public boolean isSynced() {
        return synced;
    }

    /** The fixed reason this life's record was rejected, or null. */
    public String rejectionOf(String lifeId) {
        return lifeId == null ? null : rejected.get(lifeId);
    }

    /** The stored texture for a life; empty when none is stored, the bucket is not synced, or the record was rejected. */
    public Optional<Texture> find(String lifeId) {
        return synced && lifeId != null ? Optional.ofNullable(textures.get(lifeId)) : Optional.empty();
    }

    /** A parse outcome: a texture, or the fixed reason there is none. */
    record Parsed(Texture texture, String reason) {}

    /** Parses one record stored under {@code key}; empty unless it names that life and carries a valid Mojang texture. */
    static Optional<Texture> parse(String key, byte[] value) {
        return Optional.ofNullable(check(key, value).texture());
    }

    static Parsed check(String key, byte[] value) {
        if (value == null || value.length == 0) {
            return new Parsed(null, "empty record");
        }
        try {
            JsonElement root = JsonParser.parseString(new String(value, StandardCharsets.UTF_8));
            if (!root.isJsonObject()) {
                return new Parsed(null, "not a JSON object");
            }
            JsonObject record = root.getAsJsonObject();
            String lifeId = text(record, "life_id", MAX_LIFE_ID_CHARS);
            String encoded = text(record, "value", MAX_VALUE_CHARS);
            String signature = text(record, "signature", MAX_SIGNATURE_CHARS);
            if (!key.equals(lifeId)) {
                return new Parsed(null, "life_id does not match the key");
            }
            if (encoded == null || signature == null) {
                return new Parsed(null, "value or signature missing or too long");
            }
            if (!isBase64(signature)) {
                return new Parsed(null, "signature is not base64");
            }
            if (!isMojangTexture(encoded)) {
                return new Parsed(null, "texture is not on textures.minecraft.net");
            }
            String model = text(record, "model", 16);
            return new Parsed(new Texture(encoded, signature, "slim".equals(model) ? "slim" : "classic"), null);
        } catch (RuntimeException e) {
            return new Parsed(null, "unreadable record");
        }
    }
    /** True when the value is base64 JSON whose {@code textures.SKIN.url} is an http(s) URL on the Mojang texture host. */
    static boolean isMojangTexture(String encoded) {
        try {
            String json = new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8);
            JsonObject skin = JsonParser.parseString(json).getAsJsonObject()
                    .getAsJsonObject("textures").getAsJsonObject("SKIN");
            URI url = URI.create(skin.get("url").getAsString());
            String scheme = url.getScheme();
            boolean httpScheme = "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
            return httpScheme && TEXTURE_HOST.equalsIgnoreCase(url.getHost());
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static boolean isBase64(String text) {
        try {
            Base64.getDecoder().decode(text);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** A non-blank string field no longer than {@code maxChars}, or null. */
    private static String text(JsonObject object, String field, int maxChars) {
        JsonElement element = object.get(field);
        if (element == null || !element.isJsonPrimitive() || !element.getAsJsonPrimitive().isString()) {
            return null;
        }
        String text = element.getAsString();
        return text.isBlank() || text.length() > maxChars ? null : text;
    }
}
