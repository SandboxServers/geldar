package dev.geldar.core.provenance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TakeDiffTest {
    @Test
    void aDecreaseIsCounted() {
        assertEquals(Map.of("diamond", 6), TakeDiff.taken(Map.of("diamond", 10), Map.of("diamond", 4)));
        assertEquals(Map.of("diamond", 64), TakeDiff.taken(Map.of("diamond", 64), Map.of("diamond", 0)));
    }

    @Test
    void anIncreaseIsIgnored() {
        assertTrue(TakeDiff.taken(Map.of("stone", 1), Map.of("stone", 2)).isEmpty());
        assertTrue(TakeDiff.taken(Map.of(), Map.of("stone", 9)).isEmpty());
    }

    @Test
    void aRemovedItemIsCountedAsDownToZero() {
        assertEquals(Map.of("iron_ingot", 3), TakeDiff.taken(Map.of("iron_ingot", 3), Map.of()));
    }

    @Test
    void anUnchangedSnapshotIsEmpty() {
        assertTrue(TakeDiff.taken(Map.of("stone", 5, "dirt", 2), Map.of("stone", 5, "dirt", 2)).isEmpty());
        assertTrue(TakeDiff.taken(Map.of(), Map.of()).isEmpty());
    }

    @Test
    void keysAreSorted() {
        Map<String, Integer> taken = TakeDiff.taken(Map.of("zebra", 1, "apple", 1), Map.of());
        assertEquals(List.of("apple", "zebra"), List.copyOf(taken.keySet()));
    }
}
