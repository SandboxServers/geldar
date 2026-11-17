package dev.geldar.ledger.core.census;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class DutyCyclerTest {
    @Test
    void fiveOfTwentyIsOnForTicksZeroToFourOfEachCycle() {
        DutyCycler d = new DutyCycler(5, 20);
        for (long cycle = 0; cycle < 3; cycle++) {
            for (int t = 0; t < 20; t++) {
                assertEquals(t < 5, d.on(cycle * 20 + t), "cycle " + cycle + " tick " + t);
            }
        }
        assertEquals(0.25, d.ratio(), 1e-12);
    }

    @Test
    void boundaryTicks() {
        DutyCycler d = new DutyCycler(5, 20);
        assertTrue(d.on(4));
        assertFalse(d.on(5));
        assertFalse(d.on(19));
        assertTrue(d.on(20));
    }

    @Test
    void periodOneWithOnOneIsAlwaysOn() {
        DutyCycler d = new DutyCycler(1, 1);
        for (long t = 0; t < 10; t++) {
            assertTrue(d.on(t));
        }
        assertEquals(1.0, d.ratio(), 0.0);
    }

    @Test
    void periodOneWithOnZeroIsAlwaysOff() {
        DutyCycler d = new DutyCycler(0, 1);
        for (long t = 0; t < 10; t++) {
            assertFalse(d.on(t));
        }
        assertEquals(0.0, d.ratio(), 0.0);
    }

    @Test
    void onEqualToPeriodIsAlwaysOn() {
        DutyCycler d = new DutyCycler(20, 20);
        for (long t = 0; t < 40; t++) {
            assertTrue(d.on(t));
        }
    }

    @Test
    void periodZeroMeansAlwaysOn() {
        assertTrue(DutyCycler.ALWAYS_ON.on(0));
        assertTrue(DutyCycler.ALWAYS_ON.on(123_456_789L));
        assertEquals(1.0, DutyCycler.ALWAYS_ON.ratio(), 0.0);
        assertThrows(IllegalArgumentException.class, () -> new DutyCycler(1, 0));
    }

    @Test
    void onGreaterThanPeriodIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> new DutyCycler(21, 20));
        assertThrows(IllegalArgumentException.class, () -> new DutyCycler(2, 1));
    }

    @Test
    void negativeValuesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> new DutyCycler(-1, 20));
        assertThrows(IllegalArgumentException.class, () -> new DutyCycler(0, -1));
    }

    @Test
    void largeAndNegativeTicksStayInRange() {
        DutyCycler d = new DutyCycler(5, 20);
        assertTrue(d.on(Long.MAX_VALUE - (Long.MAX_VALUE % 20)));
        assertEquals(Long.MAX_VALUE % 20 < 5, d.on(Long.MAX_VALUE));
        assertTrue(d.on(-20)); // floorMod: -20 -> 0
        assertFalse(d.on(-1)); // floorMod: -1 -> 19
    }
}
