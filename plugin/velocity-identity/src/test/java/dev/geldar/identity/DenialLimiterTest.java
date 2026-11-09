package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class DenialLimiterTest {
    private long now;
    private final List<Integer> summaries = new ArrayList<>();
    private final DenialLimiter limiter = new DenialLimiter(2, 100, () -> now, summaries::add);

    @Test
    void logsTheFirstDenialsOfAWindowAndCountsTheRest() {
        assertTrue(limiter.allow());
        assertTrue(limiter.allow());
        assertFalse(limiter.allow());
        assertFalse(limiter.allow());
        assertEquals(List.of(), summaries);
    }

    @Test
    void summarisesOnATimerTickWithoutAnotherDenial() {
        limiter.allow();
        limiter.allow();
        limiter.allow();
        limiter.allow();
        limiter.allow();
        now = 99;
        limiter.tick();
        assertEquals(List.of(), summaries, "the window is still open");
        now = 100;
        limiter.tick();
        assertEquals(List.of(3), summaries);
        limiter.tick();
        assertEquals(List.of(3), summaries, "reported once");
    }

    @Test
    void aDenialAfterTheWindowStartsANewOneAndReportsTheOldCount() {
        limiter.allow();
        limiter.allow();
        limiter.allow();
        now = 150;
        assertTrue(limiter.allow());
        assertEquals(List.of(1), summaries);
    }

    @Test
    void aQuietWindowReportsNothing() {
        limiter.allow();
        now = 500;
        limiter.tick();
        assertEquals(List.of(), summaries);
    }
}