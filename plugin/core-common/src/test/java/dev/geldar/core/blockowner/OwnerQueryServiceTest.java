package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.OwnerQueryService.Answer;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OwnerQueryServiceTest {
    private static final String WORLD = "world";
    private static final Logger LOG = Logger.getLogger("blockowner-test");

    private ExecutorService lookups;
    private final OwnerCache cache = new OwnerCache(System::currentTimeMillis);
    private final AtomicInteger calls = new AtomicInteger();

    @BeforeEach
    void setUp() {
        lookups = Executors.newSingleThreadExecutor();
    }

    @AfterEach
    void tearDown() {
        lookups.shutdownNow();
    }

    private OwnerQueryService service(OwnerSource source, long timeoutMs) {
        return new OwnerQueryService(source, cache, lookups, timeoutMs, LOG);
    }

    private static Answer await(OwnerQueryService service) throws Exception {
        return service.answer(WORLD, 0, 0).get(5, TimeUnit.SECONDS);
    }

    private static void assertEmptyUnknown(Answer answer) {
        assertTrue(answer.blocks().isEmpty());
        assertTrue(answer.truncated(), "an unknown answer must say it is not complete");
    }

    @Test
    void successReturnsTheSourceBlocks() throws Exception {
        OwnerSource source = (w, cx, cz) -> {
            calls.incrementAndGet();
            return new Owners(List.of(new OwnedBlock(1, 64, 1, "alice")), false);
        };

        Answer answer = await(service(source, 1_000));

        assertEquals(List.of(new OwnedBlock(1, 64, 1, "alice")), answer.blocks());
        assertFalse(answer.truncated());
        assertEquals(WORLD, answer.world());
    }

    @Test
    void countersCountQueriesCacheHitsAndFailures() throws Exception {
        OwnerSource ok = (w, cx, cz) -> new Owners(List.of(), false);
        OwnerQueryService service = service(ok, 1_000);
        await(service);
        assertEquals(1, service.queries());
        assertEquals(0, service.cacheHits());
        await(service);
        assertEquals(2, service.queries());
        assertEquals(1, service.cacheHits(), "the second answer is a fresh cache entry");
        assertEquals(0, service.failures());

        OwnerSource unavailable = (w, cx, cz) -> {
            throw new OwnerSource.Unavailable("no coreprotect");
        };
        OwnerQueryService failing = new OwnerQueryService(
                unavailable, new OwnerCache(System::currentTimeMillis), lookups, 1_000, LOG);
        assertEmptyUnknown(await(failing));
        assertEquals(1, failing.failures());
        assertEquals(0, failing.cacheHits());
    }

    @Test
    void aFullLookupQueueCountsAsAFailure() throws Exception {
        ExecutorService full = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1));
        CountDownLatch release = new CountDownLatch(1);
        try {
            full.execute(() -> awaitQuietly(release));
            full.execute(() -> {});
            OwnerQueryService service = new OwnerQueryService(
                    (w, cx, cz) -> new Owners(List.of(), false), cache, full, 1_000, LOG);
            assertEmptyUnknown(await(service));
            assertEquals(1, service.failures());
            assertEquals(1, service.queries());
        } finally {
            release.countDown();
            full.shutdownNow();
        }
    }

    private static void awaitQuietly(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    @Test
    void freshChunkIsServedFromTheCacheWithoutALookup() throws Exception {
        OwnerSource source = (w, cx, cz) -> {
            calls.incrementAndGet();
            return new Owners(List.of(), false);
        };
        OwnerQueryService service = service(source, 1_000);

        await(service);
        await(service);

        assertEquals(1, calls.get());
    }

    @Test
    void coreProtectNotInstalledAnswersUnknownAndDoesNotThrow() {
        OwnerSource source = (w, cx, cz) -> {
            throw new OwnerSource.Unavailable("CoreProtect is not installed");
        };

        assertDoesNotThrow(() -> assertEmptyUnknown(await(service(source, 1_000))));
    }

    @Test
    void lookupFailureAnswersUnknownAndDoesNotThrow() {
        OwnerSource source = (w, cx, cz) -> {
            throw new IllegalStateException("database is locked");
        };

        assertDoesNotThrow(() -> assertEmptyUnknown(await(service(source, 1_000))));
    }

    @Test
    void lookupPastTheTimeoutAnswersUnknownWithinTheTimeout() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        OwnerSource source = (w, cx, cz) -> {
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new Owners(List.of(new OwnedBlock(1, 64, 1, "alice")), false);
        };
        try {
            long started = System.nanoTime();
            Answer answer = await(service(source, 50));
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

            assertEmptyUnknown(answer);
            assertTrue(elapsedMs < 2_000, "answer took " + elapsedMs + " ms");
        } finally {
            release.countDown();
        }
    }

    @Test
    void fullQueueAnswersUnknownAndDoesNotThrow() throws Exception {
        ThreadPoolExecutor full = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(1));
        CountDownLatch running = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        OwnerSource source = (w, cx, cz) -> {
            running.countDown();
            try {
                release.await(10, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new Owners(List.of(), false);
        };
        OwnerQueryService service = new OwnerQueryService(source, new OwnerCache(System::currentTimeMillis),
                full, 100, LOG);
        try {
            service.answer(WORLD, 0, 0);
            assertTrue(running.await(5, TimeUnit.SECONDS));
            service.answer(WORLD, 1, 0);

            // The first lookup runs, the second waits in the one-slot queue, so the third is refused.
            Answer refused = service.answer(WORLD, 2, 0).get(5, TimeUnit.SECONDS);

            assertEmptyUnknown(refused);
        } finally {
            release.countDown();
            full.shutdownNow();
        }
    }
}
