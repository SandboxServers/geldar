package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class AttrsTest {
    @Test
    void emptyIsSharedAndEmpty() {
        assertSame(Attrs.of(), Attrs.of());
        assertTrue(Attrs.of().build().isEmpty());
    }

    @Test
    void aDiscardedResultLeavesTheBaseUnchanged() {
        Attrs a = Attrs.of();
        a.str("k", "v");
        assertTrue(a.build().isEmpty());
        assertTrue(Attrs.of().build().isEmpty());
    }

    @Test
    void sharedBaseIsNotMutatedByDerivedInstances() {
        Attrs base = Attrs.of().str("a", "1");
        Attrs x = base.lng("n", 1);
        Attrs y = base.lng("n", 2);
        assertEquals(1, base.build().size());
        assertEquals(1L, x.build().get("n"));
        assertEquals(2L, y.build().get("n"));
    }

    @Test
    void insertionOrderIsKeptAndTheLastValueOfADuplicateWins() {
        Attrs a = Attrs.of().str("b", "1").str("a", "2").str("b", "3");
        assertEquals(List.of("b", "a"), List.copyOf(a.build().keySet()));
        assertEquals("3", a.build().get("b"));
    }

    @Test
    void nullKeyAndNullValueThrowAndPrimitivesAreAccepted() {
        assertThrows(NullPointerException.class, () -> Attrs.of().str(null, "v"));
        assertThrows(NullPointerException.class, () -> Attrs.of().str("k", null));
        assertThrows(NullPointerException.class, () -> Attrs.of().lng(null, 1));
        assertEquals(true, Attrs.of().bool("b", true).build().get("b"));
    }

    @Test
    void nanAndInfiniteDoublesAreStoredAsGiven() {
        Attrs a = Attrs.of().dbl("nan", Double.NaN).dbl("inf", Double.POSITIVE_INFINITY).dbl("neg", -0.0);
        assertTrue(Double.isNaN((Double) a.build().get("nan")));
        assertEquals(Double.POSITIVE_INFINITY, a.build().get("inf"));
        assertEquals(-0.0, a.build().get("neg"));
    }
}
