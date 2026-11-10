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
    public record Texture(String value, String signature) {
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
        Optional<Texture> texture = parse(key, value);
        if (texture.isPresent()) {
            target.put(key, texture.get());
        } else {
            target.remove(key);
            // The record is not named: its content is not logged.
            log.warn("A skin record was rejected; the affected ranger keeps the default skin");
        }
    }

    /** Applies a delete or purge: the skin is removed. */
    @Override
    public synchronized void remove(String key) {
        if (key != null) {
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
    }

    @Override
    public synchronized void markUnsynced() {
        synced = false;
        replay = null;
    }

    /** The stored texture for a life; empty when none is stored, the bucket is not synced, or the record was rejected. */
    public Optional<Texture> find(String lifeId) {
        return synced && lifeId != null ? Optional.ofNullable(textures.get(lifeId)) : Optional.empty();
    }

    /** Parses one record stored under {@code key}; empty unless it names that life and carries a valid Mojang texture. */
    static Optional<Texture> parse(String key, byte[] value) {
        if (value == null || value.length == 0) {
            return Optional.empty();
        }
        try {
            JsonElement root = JsonParser.parseString(new String(value, StandardCharsets.UTF_8));
            if (!root.isJsonObject()) {
                return Optional.empty();
            }
            JsonObject record = root.getAsJsonObject();
            String lifeId = text(record, "life_id", MAX_LIFE_ID_CHARS);
            String encoded = text(record, "value", MAX_VALUE_CHARS);
            String signature = text(record, "signature", MAX_SIGNATURE_CHARS);
            if (!key.equals(lifeId) || encoded == null || signature == null) {
                return Optional.empty();
            }
            if (!isBase64(signature) || !isMojangTexture(encoded)) {
                return Optional.empty();
            }
            return Optional.of(new Texture(encoded, signature));
        } catch (RuntimeException e) {
            return Optional.empty();
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
