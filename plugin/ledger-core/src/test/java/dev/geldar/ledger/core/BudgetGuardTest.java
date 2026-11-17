package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class BudgetGuardTest {
    private final List<String> lines = new ArrayList<>();
    private final Logger logger = Logger.getAnonymousLogger();

    BudgetGuardTest() {
        logger.setUseParentHandlers(false);
        logger.addHandler(new Handler() {
            @Override
            public void publish(LogRecord r) {
                lines.add(r.getMessage());
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
    }

    private static void spin(long micros) {
        long end = System.nanoTime() + micros * 1000;
        while (System.nanoTime() < end) {
            // busy wait
        }
    }

    /** Runs calls until a timed one comes back, then holds it for {@code micros} before ending it. */
    private static void timedCall(BudgetGuard g, long micros) {
        long t;
        while ((t = g.begin()) == 0L) {
            g.end(0L);
        }
        spin(micros);
        g.end(t);
    }

    private BudgetGuard guard(int avgUs, int maxUs) {
        return new BudgetGuard("tick", logger, avgUs, maxUs);
    }

    @Test
    void overBudgetCallDisablesAndLogsOnce() {
        BudgetGuard g = guard(50, 250);
        timedCall(g, 5000);
        assertFalse(g.allowed());
        assertTrue(g.disabled());
        assertEquals(1, lines.size());
        timedCall(g, 5000);
        g.disable("again");
        assertEquals(1, lines.size());
    }

    @Test
    void underBudgetStaysAllowed() {
        BudgetGuard g = guard(5_000_000, 5_000_000);
        for (int i = 0; i < 20; i++) {
            timedCall(g, 1);
        }
        assertTrue(g.allowed());
        assertFalse(g.disabled());
        assertTrue(lines.isEmpty());
    }

    @Test
    void aboutOneCallInThousandTwentyFourIsTimed() {
        BudgetGuard g = guard(5_000_000, 5_000_000);
        int timed = 0;
        for (int i = 0; i < 10 * 1024; i++) {
            long t = g.begin();
            if (t != 0L) {
                timed++;
            }
            g.end(t);
        }
        assertEquals(10, timed);
    }

    @Test
    void stayedOffAfterUnderBudgetCallsUntilReenable() {
        BudgetGuard g = guard(50, 250);
        timedCall(g, 5000);
        assertFalse(g.allowed());
        g.setBudgets(5_000_000, 5_000_000);
        for (int i = 0; i < 5; i++) {
            timedCall(g, 1);
        }
        assertFalse(g.allowed());
        g.reenable();
        assertTrue(g.allowed());
        assertFalse(g.disabled());
    }

    @Test
    void runningAverageOverBudgetDisables() {
        // Each call is under the max (10 ms) but the mean is over 50 us.
        BudgetGuard g = guard(50, 10_000);
        for (int i = 0; i < BudgetGuard.MIN_AVG_SAMPLES - 1; i++) {
            timedCall(g, 300);
        }
        assertTrue(g.allowed());
        timedCall(g, 300);
        assertFalse(g.allowed());
        assertEquals(1, lines.size());
    }

    @Test
    void tickAverageOverridesPerCallMean() {
        BudgetGuard g = guard(50, 10_000);
        g.tickAverageUs(10.0);
        for (int i = 0; i < 2 * BudgetGuard.MIN_AVG_SAMPLES; i++) {
            timedCall(g, 300); // per-call mean would trip, but the collector reports per tick
        }
        assertTrue(g.allowed());
        g.tickAverageUs(80.0);
        assertFalse(g.allowed());
        assertEquals(1, lines.size());
    }

    @Test
    void throwingLoggerDoesNotEscape() {
        Logger bad = Logger.getAnonymousLogger();
        bad.setUseParentHandlers(false);
        bad.addHandler(new Handler() {
            @Override
            public void publish(LogRecord r) {
                throw new IllegalStateException("boom");
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        BudgetGuard g = new BudgetGuard("tick", bad, 50, 250);
        g.disable("x");
        assertFalse(g.allowed());
    }

    @Test
    void registryReturnsOneGuardPerIdWithConfigBudgets() {
        GuardRegistry r = new GuardRegistry(logger);
        LedgerConfig cfg = new LedgerConfig(
                true, Map.of(), Map.of("tick", 70), Map.of("tick", 300), Map.of(), Map.of(), Map.of(), 32768, 2000, 200, 20, true);
        BudgetGuard a = r.guard("tick", cfg);
        assertSame(a, r.guard("tick", LedgerConfig.defaults()));
        assertFalse(r.guard("other", cfg) == a);
    }

    @Test
    void reloadReenablesOnlyOnFalseThenTrue() {
        GuardRegistry r = new GuardRegistry(logger);
        BudgetGuard g = r.guard("tick", LedgerConfig.defaults());
        g.disable("x");
        // Unchanged config: stays off.
        r.reload(LedgerConfig.defaults());
        assertFalse(g.allowed());
        // Config turns the collector off: still off.
        LedgerConfig off = new LedgerConfig(
                true, Map.of("tick", false), Map.of(), Map.of(), Map.of(), Map.of(), Map.of(), 32768, 2000, 200, 20, true);
        r.reload(off);
        assertFalse(g.allowed());
        assertTrue(g.disabled());
        // Back on: false then true re-enables.
        r.reload(LedgerConfig.defaults());
        assertTrue(g.allowed());
        assertFalse(g.disabled());
    }

    @Test
    void masterOffThenOnReenables() {
        GuardRegistry r = new GuardRegistry(logger);
        BudgetGuard g = r.guard("tick", LedgerConfig.defaults());
        g.disable("x");
        r.reload(LedgerConfig.disabled());
        assertFalse(g.allowed());
        r.reload(LedgerConfig.defaults());
        assertTrue(g.allowed());
    }

    @Test
    void budgetsUpdateOnReload() {
        GuardRegistry r = new GuardRegistry(logger);
        BudgetGuard g = r.guard("tick", LedgerConfig.defaults());
        LedgerConfig big = new LedgerConfig(
                true, Map.of(), Map.of("tick", 9000), Map.of("tick", 9_000_000), Map.of(), Map.of(), Map.of(), 32768, 2000, 200, 20, true);
        r.reload(big);
        timedCall(g, 2000); // would trip the default 250 us max
        assertTrue(g.allowed());
    }
}
