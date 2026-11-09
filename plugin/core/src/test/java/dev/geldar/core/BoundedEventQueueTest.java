package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class BoundedEventQueueTest {
    @Test
    void overflowDropsOldestAndCounts() throws InterruptedException {
        BoundedEventQueue<Integer> q = new BoundedEventQueue<>(3);
        for (int i = 1; i <= 5; i++) {
            q.offer(i);
        }
        assertEquals(2, q.dropped());
        assertEquals(3, q.size());
        assertEquals(3, q.poll(1, TimeUnit.MILLISECONDS));
        assertEquals(4, q.poll(1, TimeUnit.MILLISECONDS));
        assertEquals(5, q.poll(1, TimeUnit.MILLISECONDS));
        assertNull(q.poll(1, TimeUnit.MILLISECONDS));
    }

    @Test
    void rejectsZeroCapacity() {
        assertThrows(IllegalArgumentException.class, () -> new BoundedEventQueue<>(0));
    }
}