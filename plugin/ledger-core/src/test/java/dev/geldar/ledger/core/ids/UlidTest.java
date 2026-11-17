package dev.geldar.ledger.core.ids;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class UlidTest {
    @Test
    void is26CrockfordCharactersAndUniqueOver100kCalls() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 100_000; i++) {
            String id = Ulid.next();
            assertEquals(26, id.length());
            assertTrue(id.matches("[0-9A-HJKMNP-TV-Z]{26}"), id);
            assertTrue(seen.add(id), "duplicate " + id);
        }
    }

    @Test
    void sortsByTime() {
        AtomicLong clock = new AtomicLong(1_700_000_000_000L);
        Ulid.Generator g = new Ulid.Generator(clock::get, new Random(1));
        String a = g.next();
        clock.addAndGet(1);
        String b = g.next();
        clock.addAndGet(100_000);
        String c = g.next();
        assertTrue(a.compareTo(b) < 0);
        assertTrue(b.compareTo(c) < 0);
    }

    @Test
    void fixedMillisecondAndBackwardsClockStillIncrease() {
        AtomicLong clock = new AtomicLong(5_000);
        Ulid.Generator g = new Ulid.Generator(clock::get, new Random(2));
        String prev = g.next();
        for (int i = 0; i < 10_000; i++) {
            if (i == 5_000) {
                clock.set(1_000); // the clock steps back
            }
            String next = g.next();
            assertTrue(prev.compareTo(next) < 0, prev + " then " + next);
            prev = next;
        }
    }

    @Test
    void timePartEncodesTheMillisecondClock() {
        Ulid.Generator g = new Ulid.Generator(() -> 0L, new Random(3));
        assertTrue(g.next().startsWith("0000000000"));
        Ulid.Generator late = new Ulid.Generator(() -> (1L << 48) - 1, new Random(3));
        assertTrue(late.next().startsWith("7ZZZZZZZZZ"));
    }

    @Test
    void uniqueAcrossThreads() throws Exception {
        Set<String> seen = ConcurrentHashMap.newKeySet();
        int threads = 8;
        CountDownLatch go = new CountDownLatch(1);
        Thread[] ts = new Thread[threads];
        for (int t = 0; t < threads; t++) {
            ts[t] = new Thread(() -> {
                try {
                    go.await();
                } catch (InterruptedException e) {
                    return;
                }
                for (int i = 0; i < 20_000; i++) {
                    seen.add(Ulid.next());
                }
            });
            ts[t].start();
        }
        go.countDown();
        for (Thread t : ts) {
            t.join();
        }
        assertEquals(threads * 20_000, seen.size());
    }
}
