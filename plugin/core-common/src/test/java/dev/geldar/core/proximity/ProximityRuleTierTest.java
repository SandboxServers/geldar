package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** The hearing tier boundaries (decision 0199, step 2): clear to the radius, muffled to radius + margin, else silent. */
class ProximityRuleTierTest {
    private static final double MARGIN = 8.0;

    @Test
    void clearRunsToTheRadiusInclusive() {
        assertEquals(Tier.CLEAR, ProximityRule.tier(0.0, false, MARGIN));
        assertEquals(Tier.CLEAR, ProximityRule.tier(31.9999, false, MARGIN));
        assertEquals(Tier.CLEAR, ProximityRule.tier(32.0, false, MARGIN));
    }

    @Test
    void justPastTheRadiusIsMuffled() {
        assertEquals(Tier.MUFFLED, ProximityRule.tier(32.0001, false, MARGIN));
    }

    @Test
    void muffledRunsToTheMarginInclusive() {
        assertEquals(Tier.MUFFLED, ProximityRule.tier(39.9999, false, MARGIN));
        assertEquals(Tier.MUFFLED, ProximityRule.tier(40.0, false, MARGIN));
    }

    @Test
    void justPastTheMarginIsSilent() {
        assertEquals(Tier.SILENT, ProximityRule.tier(40.0001, false, MARGIN));
    }

    @Test
    void aZeroMarginMakesTheMuffledTierEmpty() {
        assertEquals(Tier.CLEAR, ProximityRule.tier(32.0, false, 0.0));
        assertEquals(Tier.SILENT, ProximityRule.tier(32.0001, false, 0.0));
    }

    @Test
    void aCutShortRayIsSilentAtAnyDistance() {
        assertEquals(Tier.SILENT, ProximityRule.tier(0.0, true, MARGIN));
        assertEquals(Tier.SILENT, ProximityRule.tier(35.0, true, MARGIN));
    }

    @Test
    void anInfiniteOrNotANumberDistanceIsSilent() {
        assertEquals(Tier.SILENT, ProximityRule.tier(Double.POSITIVE_INFINITY, false, MARGIN));
        assertEquals(Tier.SILENT, ProximityRule.tier(Double.NaN, false, MARGIN));
    }

    @Test
    void theAbsorptionTierAgreesWithTheRuleAtTheMarginOfTheDefaults() {
        double[] distances = {0.0, 32.0, 32.0001, 40.0, 40.0001, 1000.0};
        for (double d : distances) {
            assertEquals(ProximityRule.tier(d, false, MuffleConfig.MARGIN), Absorption.tier(d, false), "d=" + d);
            assertEquals(ProximityRule.tier(d, true, MuffleConfig.MARGIN), Absorption.tier(d, true), "d=" + d);
        }
    }
}
