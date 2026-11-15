package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class LineBudgetTest {
    @Test
    void aTakeWithinTheCapIsAccepted() {
        LineBudget budget = new LineBudget(MuffleConfig.PER_LINE_READ_CAP);
        assertTrue(budget.take(64));
        assertEquals(448, budget.remaining());
    }

    @Test
    void aTakeOfExactlyWhatRemainsIsAccepted() {
        LineBudget budget = new LineBudget(MuffleConfig.PER_LINE_READ_CAP);
        assertTrue(budget.take(512));
        assertEquals(0, budget.remaining());
    }

    @Test
    void aTakeOverTheCapIsRefusedAndDeductsNothing() {
        LineBudget budget = new LineBudget(MuffleConfig.PER_LINE_READ_CAP);
        assertTrue(budget.take(500));
        assertFalse(budget.take(13));
        assertEquals(12, budget.remaining());
    }

    @Test
    void aSingleTakeOverTheCapIsRefused() {
        assertFalse(new LineBudget(MuffleConfig.PER_LINE_READ_CAP).take(513));
    }

    @Test
    void aNegativeTakeIsRefused() {
        LineBudget budget = new LineBudget(10);
        assertFalse(budget.take(-1));
        assertEquals(10, budget.remaining());
    }

    @Test
    void aNegativeCapIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> new LineBudget(-1));
    }
}
