package dev.geldar.ledger.neoforge.world;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DimensionNamesTest {
    @Test
    void anOftenSeenKeyIsNamedOnceAndReturnsTheSameString() {
        AtomicInteger calls = new AtomicInteger();
        DimensionNames<Integer> n = new DimensionNames<>(k -> {
            calls.incrementAndGet();
            return "dim" + k;
        });
        String first = n.of(7);
        for (int i = 0; i < 1000; i++) {
            assertSame(first, n.of(7));
        }
        assertEquals(1, calls.get());
        assertEquals("dim8", n.of(8));
        assertEquals(2, calls.get());
    }

    @Test
    void theCacheIsBoundedButKeysPastTheCapAreStillNamed() {
        AtomicInteger calls = new AtomicInteger();
        DimensionNames<Integer> n = new DimensionNames<>(k -> {
            calls.incrementAndGet();
            return "d" + k;
        });
        for (int i = 0; i < DimensionNames.MAX + 10; i++) {
            n.of(i);
        }
        int before = calls.get();
        assertEquals("d" + (DimensionNames.MAX + 5), n.of(DimensionNames.MAX + 5));
        assertEquals(before + 1, calls.get()); // not cached
        n.of(3);
        assertEquals(before + 1, calls.get()); // cached
    }
}