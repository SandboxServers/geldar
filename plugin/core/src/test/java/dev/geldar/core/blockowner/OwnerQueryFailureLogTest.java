package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Handler;
import java.util.logging.Logger;
import java.util.logging.LogRecord;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OwnerQueryFailureLogTest {
    private final List<String> warnings = new ArrayList<>();
    private final AtomicLong clockMs = new AtomicLong();
    private ExecutorService lookups;

    @BeforeEach
    void setUp() {
        lookups = Executors.newSingleThreadExecutor();
    }

    @AfterEach
    void tearDown() {
        lookups.shutdownNow();
    }

    /** A logger that keeps its records in memory, so the test reads what an operator would see. */
    private Logger capturingLogger() {
        Logger log = Logger.getAnonymousLogger();
        log.setUseParentHandlers(false);
        log.addHandler(new Handler() {
            @Override
            public void publish(LogRecord record) {
                warnings.add(record.getMessage());
            }

            @Override
            public void flush() {
                // Nothing buffered.
            }

            @Override
            public void close() {
                // Nothing to release.
            }
        });
        return log;
    }

    private OwnerQueryService service(OwnerSource source) {
        return new OwnerQueryService(source, new OwnerCache(System::currentTimeMillis), lookups, 1_000,
                capturingLogger(), clockMs::get);
    }

    private void ask(OwnerQueryService service) throws Exception {
        service.answer("world", 0, 0).get(5, TimeUnit.SECONDS);
    }

    private static RuntimeException deepThrow(int depth) {
        if (depth == 0) {
            return new UnsupportedOperationException();
        }
        return deepThrow(depth - 1);
    }

    @Test
    void theFirstFailureLogsItsRootCauseAndLaterOnesWaitForTheWindow() throws Exception {
        OwnerQueryService service = service((w, cx, cz) -> {
            throw new UnsupportedOperationException();
        });

        clockMs.set(0);
        ask(service);
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("java.lang.UnsupportedOperationException"), warnings.get(0));
        assertFalse(warnings.get(0).contains("CompletionException"), "the wrapper must not be the reported cause");

        clockMs.set(60_000);
        ask(service);
        clockMs.set(120_000);
        ask(service);
        clockMs.set(LookupFailureLog.WINDOW_MS - 1);
        ask(service);
        assertEquals(1, warnings.size(), "no second line inside the five-minute window");

        clockMs.set(LookupFailureLog.WINDOW_MS);
        ask(service);
        assertEquals(2, warnings.size(), "one line when the window has passed");
        assertTrue(warnings.get(1).contains("(3 more failures since the last report)"), warnings.get(1));
    }

    @Test
    void theLoggedStackIsBoundedToTenFramesOfTheRootCause() throws Exception {
        OwnerQueryService service = service((w, cx, cz) -> {
            throw new IllegalStateException("wrapper", deepThrow(40));
        });

        ask(service);

        long frames = warnings.get(0).lines().filter(line -> line.startsWith("    at ")).count();
        assertEquals(LookupFailureLog.MAX_FRAMES, frames);
    }

    @Test
    void aRefusedOrUnavailableSourceLogsOnceWithoutAStack() throws Exception {
        OwnerQueryService service = service((w, cx, cz) -> {
            throw new OwnerSource.Unavailable("CoreProtect is not installed");
        });

        ask(service);
        ask(service);

        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).endsWith("CoreProtect is not installed"), warnings.get(0));
    }
}
