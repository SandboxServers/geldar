package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class BubbleBookTest {
    private static final UUID AGENT = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    void secondPutReplacesTheFirstAndRestartsTheClock() {
        BubbleBook book = new BubbleBook();
        book.put(AGENT, "one", 0L);
        book.put(AGENT, "two", 11_000L);
        assertEquals(1, book.snapshot().size());
        assertEquals("two", book.snapshot().get(AGENT));
        assertFalse(book.expired(12_000L).contains(AGENT));
        assertTrue(book.expired(23_000L).contains(AGENT));
    }

    @Test
    void expiryAtExactlyTheLifetimeBoundary() {
        BubbleBook book = new BubbleBook();
        assertEquals(12_000L, BubbleBook.LIFETIME_MILLIS);
        book.put(AGENT, "hi", 1_000L);
        assertFalse(book.expired(1_000L + BubbleBook.LIFETIME_MILLIS - 1).contains(AGENT));
        assertTrue(book.expired(1_000L + BubbleBook.LIFETIME_MILLIS).contains(AGENT));
    }

    @Test
    void expiredDoesNotRemove() {
        BubbleBook book = new BubbleBook();
        book.put(AGENT, "hi", 0L);
        assertTrue(book.expired(50_000L).contains(AGENT));
        assertEquals("hi", book.snapshot().get(AGENT));
    }

    @Test
    void removeDropsTheBubble() {
        BubbleBook book = new BubbleBook();
        book.put(AGENT, "hi", 0L);
        book.remove(AGENT);
        assertTrue(book.snapshot().isEmpty());
        assertTrue(book.expired(50_000L).isEmpty());
    }

    @Test
    void bubblesOfDifferentAgentsAreKeptApart() {
        BubbleBook book = new BubbleBook();
        UUID other = UUID.fromString("00000000-0000-0000-0000-000000000002");
        book.put(AGENT, "a", 0L);
        book.put(other, "b", 5_000L);
        book.remove(AGENT);
        assertEquals("b", book.snapshot().get(other));
        assertFalse(book.snapshot().containsKey(AGENT));
    }
}
