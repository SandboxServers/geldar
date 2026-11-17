package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.LedgerConfig;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class JfrWiringTest {
    private final Logger log = Logger.getAnonymousLogger();
    private int starts;
    private int stops;
    private boolean boom;
    private boolean inert;

    private JfrWiring wiring() {
        return new JfrWiring(log, (ledger, config) -> {
            starts++;
            if (boom) {
                throw new IllegalStateException("x");
            }
            boolean up = !inert;
            return new JfrWiring.Handle() {
                public boolean running() {
                    return up;
                }

                public void stop() {
                    stops++;
                }
            };
        }, Runnable::run);
    }

    private static LedgerConfig on(boolean master, boolean jfr) {
        return LedgerConfig.defaults().withEnabled(master).withJfrEnabled(jfr);
    }

    @Test
    void defaultConfigNeverStartsJfr() {
        JfrWiring w = wiring();
        w.sync(LedgerConfig.defaults(), null);
        assertEquals(0, starts);
        assertFalse(w.started());
    }

    @Test
    void startsOnceWhileOnStopsWhenOffAndRestartsOnReenable() {
        JfrWiring w = wiring();
        w.sync(on(true, true), null);
        w.sync(on(true, true), null);
        assertEquals(1, starts);
        assertTrue(w.started());
        w.sync(on(true, false), null);
        assertFalse(w.started());
        assertEquals(1, stops);
        w.sync(on(true, true), null);
        assertEquals(2, starts);
        w.sync(on(false, true), null); // master off wins
        assertFalse(w.started());
        w.stop(); // idempotent
        assertEquals(2, stops);
    }

    @Test
    void aThrowingStarterLeavesJfrOffAndNeverThrows() {
        JfrWiring w = wiring();
        boom = true;
        w.sync(on(true, true), null);
        assertFalse(w.started());
        boom = false;
        w.sync(on(true, true), null);
        assertTrue(w.started());
    }

    @Test
    void anInertRunnerIsNotStartedAndIsRetriedOncePerConfigApplyOnly() {
        JfrWiring w = wiring();
        inert = true; // what JfrRunner.start returns when JFR is unavailable or its start failed
        w.sync(on(true, true), null);
        assertFalse(w.started());
        assertEquals(1, starts, "one try per apply, no loop");
        w.sync(on(true, true), null);
        assertEquals(2, starts);
        assertEquals(1, stops, "the dead one is released before the retry");
        inert = false;
        w.sync(on(true, true), null);
        assertTrue(w.started());
        w.sync(on(true, true), null);
        assertEquals(3, starts, "a running runner is not replaced");
    }

    @Test
    void aSlowStopNeverBlocksTheCallingThread() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch stopped = new CountDownLatch(1);
        JfrWiring w = new JfrWiring(log, (l, c) -> new JfrWiring.Handle() {
            public boolean running() {
                return true;
            }

            public void stop() {
                try {
                    release.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                stopped.countDown();
            }
        }, r -> {
            Thread t = new Thread(r);
            t.setDaemon(true);
            t.start();
        });
        w.sync(on(true, true), null);
        long t0 = System.nanoTime();
        w.stop();
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 500, "stop returned while the runner was still stopping");
        assertEquals(1, stopped.getCount());
        release.countDown();
        assertTrue(stopped.await(5, TimeUnit.SECONDS));
    }
}
