package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class TickWindowTest {
    private static final long MS = 1_000_000L;

    @Test
    void noTicksReadAsFullSpeed() {
        assertEquals(20.0, new TickWindow().tps());
    }

    @Test
    void fiftyMillisecondTicksAreTwentyTps() {
        TickWindow w = new TickWindow();
        for (int i = 0; i < 10; i++) {
            w.record(50 * MS);
        }
        assertEquals(20.0, w.tps(), 1e-9);
    }

    @Test
    void slowTicksReadAsTheirRate() {
        TickWindow w = new TickWindow();
        for (int i = 0; i < 10; i++) {
            w.record(100 * MS);
        }
        assertEquals(10.0, w.tps(), 1e-9);
    }

    @Test
    void theCapIsTwentyEvenForFastTicks() {
        TickWindow w = new TickWindow();
        w.record(MS);
        assertEquals(20.0, w.tps(), 1e-9);
    }

    @Test
    void unfilledSlotsAreNotCountedAsZeroTicks() {
        TickWindow w = new TickWindow();
        w.record(100 * MS);
        w.record(100 * MS);
        w.record(100 * MS);
        assertEquals(3, w.size());
        assertEquals(10.0, w.tps(), 1e-9);
    }

    @Test
    void theWindowKeepsOnlyTheLastMinute() {
        TickWindow w = new TickWindow();
        for (int i = 0; i < TickWindow.SIZE; i++) {
            w.record(100 * MS);
        }
        for (int i = 0; i < TickWindow.SIZE; i++) {
            w.record(50 * MS);
        }
        assertEquals(TickWindow.SIZE, w.size());
        assertEquals(20.0, w.tps(), 1e-9);
    }

    @Test
    void aNegativeDurationIsStoredAsZeroAndNeverDivides() {
        TickWindow w = new TickWindow();
        w.record(-5 * MS);
        assertEquals(20.0, w.tps(), 1e-9);
    }
}
