package dev.geldar.ledger.paper.tick;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.destroystokyo.paper.event.server.ServerTickEndEvent;
import dev.geldar.ledger.core.BoundCounter;
import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.tick.StallDetector;
import dev.geldar.ledger.core.tick.TickStats;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.junit.jupiter.api.Test;

class TickEndListenerTest {
    final List<Double> recorded = new ArrayList<>();
    final List<long[]> slow = new ArrayList<>();
    long overruns;
    int begins;
    int ends;
    boolean allowed = true;
    boolean throwing;
    final AtomicLong clock = new AtomicLong();
    final StallDetector stall = new StallDetector(2000, clock::get);

    TickEndListener listener() {
        BoundHistogram h = v -> {
            if (throwing) {
                throw new IllegalStateException("boom");
            }
            recorded.add(v);
        };
        BoundCounter c = n -> overruns += n;
        CollectorGuard g = new CollectorGuard() {
            public boolean allowed() {
                return allowed;
            }

            public long begin() {
                begins++;
                return 7;
            }

            public void end(long token) {
                assertEquals(7, token);
                ends++;
            }
        };
        EventLog ev = (EventLog) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
                    if (m.getName().equals("record")) {
                        slow.add(new long[] {(int) a[0], (long) a[1], (long) a[2], (long) a[3]});
                    }
                    return null;
                });
        return new TickEndListener(h, c, new TickStats(), stall, g, ev, 42);
    }

    @Test
    void tenTicksOf55MsCountTenSamplesAndTenOverruns() {
        TickEndListener l = listener();
        for (int i = 0; i < 10; i++) {
            l.onTickEnd(new ServerTickEndEvent(i, 55.0, 0));
        }
        assertEquals(10, recorded.size());
        assertEquals(10, overruns);
        assertTrue(slow.isEmpty());
    }

    @Test
    void exactly50MsIsNotAnOverrun() {
        listener().onTickEnd(new ServerTickEndEvent(1, 50.0, 0));
        assertEquals(0, overruns);
    }

    @Test
    void slowTickWritesOneRecordAndFastTickNone() {
        TickEndListener l = listener();
        l.onTickEnd(new ServerTickEndEvent(9, 10.0, 0));
        assertTrue(slow.isEmpty());
        l.onTickEnd(new ServerTickEndEvent(10, 120.0, 0));
        assertEquals(1, slow.size());
        assertEquals(42, slow.get(0)[0]);
        assertEquals(10, slow.get(0)[1]);
        assertEquals(120, slow.get(0)[2]);
        assertEquals(1, slow.get(0)[3]);
    }

    @Test
    void guardIsPairedOncePerEvent() {
        TickEndListener l = listener();
        l.onTickEnd(new ServerTickEndEvent(1, 5.0, 0));
        l.onTickEnd(new ServerTickEndEvent(2, 200.0, 0));
        assertEquals(2, begins);
        assertEquals(2, ends);
    }

    @Test
    void disabledGuardSkipsEverything() {
        allowed = false;
        listener().onTickEnd(new ServerTickEndEvent(1, 500.0, 0));
        assertEquals(0, begins);
        assertTrue(recorded.isEmpty());
    }

    @Test
    void exceptionInsideNeverEscapesAndGuardStillEnds() {
        throwing = true;
        listener().onTickEnd(new ServerTickEndEvent(1, 5.0, 0));
        assertEquals(1, ends);
    }

    @Test
    void heartbeatKeepsStallDetectorQuiet() {
        TickEndListener l = listener();
        clock.set(1_900_000_000L);
        l.onTickEnd(new ServerTickEndEvent(1, 5.0, 0));
        clock.set(3_000_000_000L);
        assertFalse(stall.check());
        clock.set(3_950_000_000L);
        assertTrue(stall.check());
    }

    @Test
    void handlerIsMonitorAndNotIgnoringCancelled() throws Exception {
        Method m = TickEndListener.class.getMethod("onTickEnd", ServerTickEndEvent.class);
        EventHandler h = m.getAnnotation(EventHandler.class);
        assertEquals(EventPriority.MONITOR, h.priority());
        assertFalse(h.ignoreCancelled());
    }

    @Test
    void noTickManagerSetterIsReferencedInSources() throws Exception {
        for (String f : List.of("TickCollector.java", "TickEndListener.java", "TpsGauges.java")) {
            String src = Files.readString(Path.of("src/main/java/dev/geldar/ledger/paper/tick", f));
            assertFalse(src.matches("(?s).*\\.(setTickRate|setFrozen|requestGameToSprint|stopSprinting|step|stopStepping)\\(.*"), f);
            assertFalse(src.contains("ServerTickStartEvent"), f);
            assertFalse(src.contains("getTickTimes"), f);
        }
    }
}
