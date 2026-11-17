package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

/** Ledger warnings must reach the server log sink (not only stderr), and the listener order must hold. */
class LedgerLogTest {
    @Test
    void recordsReachTheSinkWithLevelAndMessageOnly() {
        List<String> got = new ArrayList<>();
        Logger log = LedgerLog.forSink((level, msg) -> got.add(level + "|" + msg));
        log.warning("ledger setup failed, ledger off: java.lang.IllegalStateException");
        log.log(Level.SEVERE, "x", new RuntimeException("secret-detail"));
        assertEquals(List.of("WARNING|ledger setup failed, ledger off: java.lang.IllegalStateException", "SEVERE|x"), got);
    }

    @Test
    void aThrowingSinkNeverReachesTheCaller() {
        Logger log = LedgerLog.forSink((level, msg) -> {
            throw new IllegalStateException("sink down");
        });
        assertDoesNotThrow(() -> log.warning("m"));
    }

    @Test
    void theServerLoggerForwardsToSlf4jWithoutThrowing() {
        assertDoesNotThrow(() -> LedgerLog.server().warning("ledger test message"));
    }

    @Test
    void schedulerLogsThroughTheGivenLogger() {
        List<String> got = new ArrayList<>();
        Logger log = LedgerLog.forSink((level, msg) -> got.add(msg));
        NeoForgeHostScheduler s = new NeoForgeHostScheduler(log);
        s.everyTicks(1, () -> {
            throw new IllegalStateException("boom");
        });
        s.onServerTick();
        assertEquals(List.of("ledger tick task failed: java.lang.IllegalStateException"), got);
        s.close();
    }

    /**
     * The NeoForge bus cannot be built outside the loader, so the order is pinned on source: Post listeners run in
     * registration order, so TickWiring.install (which measures) must come before the scheduler's Post listener.
     */
    @Test
    void schedulerPostListenerIsRegisteredAfterTickWiring() throws IOException {
        String src = Files.readString(Path.of("src/main/java/dev/geldar/ledger/neoforge/LedgerMod.java"));
        int wiring = src.indexOf("TickWiring.install(");
        int sched = src.indexOf("ServerTickEvent.Post.class, e -> scheduler.onServerTick()");
        assertTrue(wiring > 0 && sched > 0, "both registrations present");
        assertTrue(wiring < sched, "TickWiring must be installed before the scheduler Post listener");
    }
}
