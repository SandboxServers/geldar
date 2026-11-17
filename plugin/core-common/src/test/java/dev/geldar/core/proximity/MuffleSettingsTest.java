package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Config values for chat.muffle are clamped, and each change is logged with its key (decision 0199, spec 5.9). */
class MuffleSettingsTest {
    private final List<String> log = new ArrayList<>();

    private MuffleSettings clamp(double margin, double sealed, int line, int ray) {
        return MuffleSettings.clamped(margin, sealed, line, ray, log::add);
    }

    @Test
    void validValuesAreKeptAndNothingIsLogged() {
        assertEquals(new MuffleSettings(6.0, 2.5, 300, 40), clamp(6.0, 2.5, 300, 40));
        assertTrue(log.isEmpty(), log.toString());
    }

    @Test
    void zeroIsAValidMarginAndPenalty() {
        assertEquals(new MuffleSettings(0.0, 0.0, 1, 1), clamp(0.0, 0.0, 1, 1));
        assertTrue(log.isEmpty(), log.toString());
    }

    @Test
    void aNegativeMarginBecomesZeroAndIsLogged() {
        assertEquals(0.0, clamp(-3.0, 4.0, 512, 64).margin());
        assertEquals(1, log.size());
        assertTrue(log.get(0).contains("chat.muffle.margin"), log.toString());
    }

    @Test
    void aNotANumberOrInfiniteMarginBecomesTheDefaultAndIsLogged() {
        assertEquals(MuffleConfig.MARGIN, clamp(Double.NaN, 4.0, 512, 64).margin());
        assertEquals(MuffleConfig.MARGIN, clamp(Double.POSITIVE_INFINITY, 4.0, 512, 64).margin());
        assertEquals(2, log.size());
        assertTrue(log.get(0).contains("chat.muffle.margin"), log.toString());
    }

    @Test
    void aNegativeSealedPenaltyBecomesZeroAndNamesItsKey() {
        assertEquals(0.0, clamp(8.0, -1.0, 512, 64).sealedPenalty());
        assertEquals(1, log.size());
        assertTrue(log.get(0).contains("chat.muffle.sealed_penalty"), log.toString());
    }

    @Test
    void aNotANumberSealedPenaltyBecomesTheDefault() {
        assertEquals(MuffleConfig.SEALED_PENALTY, clamp(8.0, Double.NaN, 512, 64).sealedPenalty());
        assertEquals(1, log.size());
    }

    @Test
    void capsBelowOneBecomeOneAndEachIsLogged() {
        MuffleSettings s = clamp(8.0, 4.0, 0, -5);
        assertEquals(1, s.perLineCap());
        assertEquals(1, s.perRayCap());
        assertEquals(2, log.size());
        assertTrue(log.get(0).contains("chat.muffle.per_line_cap"), log.toString());
        assertTrue(log.get(1).contains("chat.muffle.per_ray_cap"), log.toString());
    }

    @Test
    void theConstructorStillRefusesWhatTheClampWouldFix() {
        assertThrows(IllegalArgumentException.class, () -> new MuffleSettings(-1.0, 4.0, 512, 64));
        assertThrows(IllegalArgumentException.class, () -> new MuffleSettings(8.0, 4.0, 0, 64));
    }
}
