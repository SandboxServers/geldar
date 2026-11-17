package dev.geldar.ledger.neoforge.world;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Caches the display name of a dimension key, so the chunk and entity hot path allocates no String per event. At most
 * {@value #MAX} keys are cached; a key past the cap is still named, just not cached.
 */
final class DimensionNames<K> {
    static final int MAX = 64;

    private final Map<K, String> cache = new ConcurrentHashMap<>();
    private final Function<K, String> namer;

    DimensionNames(Function<K, String> namer) {
        this.namer = namer;
    }

    String of(K key) {
        String s = cache.get(key);
        if (s != null) {
            return s;
        }
        s = namer.apply(key);
        if (cache.size() < MAX) {
            cache.put(key, s);
        }
        return s;
    }
}
