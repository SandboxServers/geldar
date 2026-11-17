package dev.geldar.ledger.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable attribute map for {@link EventLog#emitMap}. Each method returns a new instance, so a shared base can
 * never be changed by a later call. Keys and values are null-checked. Off the hot path only.
 */
public final class Attrs {
    private static final Attrs EMPTY = new Attrs(Map.of());

    private final Map<String, Object> values;

    private Attrs(Map<String, Object> values) {
        this.values = values;
    }

    public static Attrs of() {
        return EMPTY;
    }

    public Attrs str(String key, String value) {
        return with(key, Objects.requireNonNull(value, "value"));
    }

    public Attrs lng(String key, long value) {
        return with(key, value);
    }

    public Attrs dbl(String key, double value) {
        return with(key, value);
    }

    public Attrs bool(String key, boolean value) {
        return with(key, value);
    }

    /** The immutable map; insertion order is kept. */
    public Map<String, Object> build() {
        return values;
    }

    private Attrs with(String key, Object value) {
        Objects.requireNonNull(key, "key");
        Map<String, Object> copy = new LinkedHashMap<>(values);
        copy.put(key, value);
        return new Attrs(Collections.unmodifiableMap(copy));
    }
}
