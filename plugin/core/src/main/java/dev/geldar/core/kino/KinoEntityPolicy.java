package dev.geldar.core.kino;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import java.util.function.ToIntFunction;

/**
 * Which entities may appear in the Kino entity feed (decision 0139): registered agents' bodies and mobs only.
 * Every other player (a human spectator, a ghost, an admin) is left out, and so are marker-like entities.
 */
final class KinoEntityPolicy {
    /** Entity types that carry plugin data rather than anything a viewer should see. */
    static final Set<String> EXCLUDED_TYPES = Set.of("minecraft:marker", "minecraft:interaction");

    private KinoEntityPolicy() {}

    /** {@code playerName} is null for a non-player entity. A player is included only when {@code isAgent} says so. */
    static boolean include(String typeKey, String playerName, Predicate<String> isAgent) {
        if (EXCLUDED_TYPES.contains(typeKey)) {
            return false;
        }
        if (playerName != null) {
            return isAgent.test(playerName);
        }
        return !"minecraft:player".equals(typeKey);
    }

    /** Sorted by id with each id once, so a paging offset is stable between calls. */
    static <T> List<T> orderedDistinct(List<T> in, ToIntFunction<T> id) {
        List<T> sorted = new ArrayList<>(in);
        sorted.sort(Comparator.comparingInt(id));
        Set<Integer> seen = new HashSet<>();
        List<T> out = new ArrayList<>();
        for (T t : sorted) {
            if (seen.add(id.applyAsInt(t))) {
                out.add(t);
            }
        }
        return out;
    }
}