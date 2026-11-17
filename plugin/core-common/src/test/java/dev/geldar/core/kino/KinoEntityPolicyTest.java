package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class KinoEntityPolicyTest {
    private static final Set<String> AGENTS = Set.of("tessa");

    @Test
    void aNonAgentPlayerIsNeverInTheFeed() {
        assertFalse(KinoEntityPolicy.include("minecraft:player", "a_human", AGENTS::contains));
        assertFalse(KinoEntityPolicy.include("minecraft:player", null, AGENTS::contains));
    }

    @Test
    void anAgentBodyAndMobsAreIncluded() {
        assertTrue(KinoEntityPolicy.include("minecraft:player", "tessa", AGENTS::contains));
        assertTrue(KinoEntityPolicy.include("minecraft:cow", null, AGENTS::contains));
    }

    @Test
    void markerLikeEntitiesAreLeftOut() {
        assertFalse(KinoEntityPolicy.include("minecraft:marker", null, AGENTS::contains));
        assertFalse(KinoEntityPolicy.include("minecraft:interaction", null, AGENTS::contains));
    }

    @Test
    void orderedDistinctSortsByIdAndListsAnEntityOnce() {
        List<Integer> out = KinoEntityPolicy.orderedDistinct(List.of(5, 2, 5, 9, 2), i -> i);
        assertEquals(List.of(2, 5, 9), out);
    }
}