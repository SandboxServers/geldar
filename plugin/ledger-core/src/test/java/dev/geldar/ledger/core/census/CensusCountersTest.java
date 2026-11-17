package dev.geldar.ledger.core.census;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.Counter;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class CensusCountersTest {
    /** Records every counter registration and the series bound, keyed "Class|cancelled". */
    private static final class Fake {
        final Map<String, AtomicLong> series = new ConcurrentHashMap<>();
        final List<String> registered = new ArrayList<>();
        final List<String[]> registeredKeys = new ArrayList<>();

        Ledger ledger() {
            return (Ledger) Proxy.newProxyInstance(
                    Ledger.class.getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
                        if (!m.getName().equals("counter")) {
                            throw new UnsupportedOperationException(m.getName());
                        }
                        registered.add((String) a[0]);
                        registeredKeys.add((String[]) a[3]);
                        return (Counter) values -> {
                            AtomicLong cell = new AtomicLong();
                            series.put(values[0] + "|" + values[1], cell);
                            return (BoundCounter) cell::addAndGet;
                        };
                    });
        }

        long get(String cls, boolean cancelled) {
            return series.get(cls + "|" + cancelled).get();
        }
    }

    @Test
    void countsLandInTheRightSeriesByClassAndCancelledFlag() {
        Fake f = new Fake();
        CensusCounters c = new CensusCounters(f.ledger(), List.of("A", "B", "C"));
        c.count(0, false);
        c.count(1, true);
        c.count(1, true);
        c.count(2, false);
        c.count(2, false);
        c.count(2, false);
        assertEquals(1, f.get("A", false));
        assertEquals(0, f.get("A", true));
        assertEquals(0, f.get("B", false));
        assertEquals(2, f.get("B", true));
        assertEquals(3, f.get("C", false));
        assertEquals(0, f.get("C", true));
        assertEquals(6, f.series.size());
    }

    @Test
    void registersOneCounterWithTheFrozenNameAndBareMetricKeys() {
        Fake f = new Fake();
        new CensusCounters(f.ledger(), List.of("A"));
        assertEquals(List.of(Names.Census.EVENT_COUNT_TOTAL), f.registered);
        assertArrayEquals(new String[] {AttrKeys.M_EVENT_CLASS, AttrKeys.M_CANCELLED}, f.registeredKeys.get(0));
    }

    @Test
    void unknownClassNameCreatesNoCounter() {
        Fake f = new Fake();
        CensusCounters c = new CensusCounters(f.ledger(), List.of("A"));
        int before = f.series.size();
        c.count("NotOnTheList", false);
        c.count("NotOnTheList", true);
        c.count("A", false);
        assertEquals(before, f.series.size());
        assertEquals(2, c.unknown());
        assertEquals(-1, c.indexOf("NotOnTheList"));
        assertEquals(1, f.get("A", false));
    }

    @Test
    void duplicateAndBlankNamesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> new CensusCounters(new Fake().ledger(), List.of("A", "B", "A")));
        assertThrows(IllegalArgumentException.class, () -> new CensusCounters(new Fake().ledger(), List.of("A", " ")));
    }

    @Test
    void emptyAllowListIsValidAndCountsNothing() {
        CensusCounters c = new CensusCounters(new Fake().ledger(), List.of());
        c.count("A", false);
        assertEquals(0, c.size());
        assertEquals(1, c.unknown());
    }

    @Test
    void concurrentCountingLosesNothing() throws Exception {
        Fake f = new Fake();
        CensusCounters c = new CensusCounters(f.ledger(), List.of("A", "B"));
        int threads = 8;
        int per = 200_000;
        CountDownLatch start = new CountDownLatch(1);
        List<Thread> ts = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            int id = t;
            Thread th = new Thread(() -> {
                try {
                    start.await();
                } catch (InterruptedException e) {
                    return;
                }
                for (int i = 0; i < per; i++) {
                    c.count(id % 2, (i & 1) == 0);
                }
            });
            th.start();
            ts.add(th);
        }
        start.countDown();
        for (Thread th : ts) {
            th.join();
        }
        long each = (long) threads / 2 * per / 2;
        assertEquals(each, f.get("A", true));
        assertEquals(each, f.get("A", false));
        assertEquals(each, f.get("B", true));
        assertEquals(each, f.get("B", false));
    }

    @Test
    void oneMillionCountsAllocateAlmostNothing() {
        Fake f = new Fake();
        CensusCounters c = new CensusCounters(f.ledger(), List.of("A", "B"));
        for (int i = 0; i < 50_000; i++) { // warm up
            c.count(i & 1, false);
        }
        var mx = (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
        long id = Thread.currentThread().threadId();
        long before = mx.getThreadAllocatedBytes(id);
        for (int i = 0; i < 1_000_000; i++) {
            c.count(i & 1, (i & 2) != 0);
        }
        long used = mx.getThreadAllocatedBytes(id) - before;
        assertTrue(used < 16_384, "allocated " + used + " bytes");
    }
}
