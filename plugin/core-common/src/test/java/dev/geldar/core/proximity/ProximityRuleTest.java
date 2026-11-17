package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ProximityRuleTest {
    @Test
    void theRadiusIsThirtyTwoBlocks() {
        assertEquals(32.0, ProximityRule.HEARING_RADIUS_BLOCKS);
    }

    @Test
    void heardAtDistanceZeroAndJustInside() {
        assertTrue(ProximityRule.heard(true, 0, 0, 0));
        assertTrue(ProximityRule.heard(true, 31.99, 0, 0));
        assertTrue(ProximityRule.heard(true, -31.99, 0, 0));
        assertTrue(ProximityRule.heard(true, 0, 0, -31.99));
    }

    @Test
    void exactlyThirtyTwoBlocksIsHeardOnEveryAxisAndSign() {
        assertTrue(ProximityRule.heard(true, 32.0, 0, 0));
        assertTrue(ProximityRule.heard(true, -32.0, 0, 0));
        assertTrue(ProximityRule.heard(true, 0, 32.0, 0));
        assertTrue(ProximityRule.heard(true, 0, -32.0, 0));
        assertTrue(ProximityRule.heard(true, 0, 0, 32.0));
        assertTrue(ProximityRule.heard(true, 0, 0, -32.0));
    }

    @Test
    void justBeyondThirtyTwoIsNotHeardOnAnyAxis() {
        assertFalse(ProximityRule.heard(true, 32.01, 0, 0));
        assertFalse(ProximityRule.heard(true, 0, -32.01, 0));
        assertFalse(ProximityRule.heard(true, 0, 0, 32.01));
    }

    @Test
    void theDistanceIsThreeDimensional() {
        // 3 * 18.4^2 = 1015.68 <= 1024: inside the sphere on the diagonal.
        assertTrue(ProximityRule.heard(true, 18.4, 18.4, 18.4));
        // 3 * 20^2 = 1200 > 1024: outside, although each axis alone is under 32.
        assertFalse(ProximityRule.heard(true, 20, 20, 20));
        // Vertical distance counts: 40 blocks straight up is out of reach.
        assertFalse(ProximityRule.heard(true, 0, 40, 0));
    }

    @Test
    void anotherWorldIsNeverHeard() {
        assertFalse(ProximityRule.heard(false, 0, 0, 0));
        assertFalse(ProximityRule.heard(false, 1, 1, 1));
    }

    @Test
    void aNotANumberOffsetIsNotHeard() {
        assertFalse(ProximityRule.heard(true, Double.NaN, 0, 0));
    }
}
