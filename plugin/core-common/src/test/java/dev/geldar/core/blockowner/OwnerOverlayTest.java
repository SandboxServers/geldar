package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerQueryService.Answer;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The recent-change overlay on a fake clock: it expires, it is counted once, and its miss line is rate limited. */
class OwnerOverlayTest {
    private static final String WORLD = "world";
    private static final Owners NOTHING = new Owners(List.of(), false);

    private long now;
    private OwnerCache cache;
    private ExecutorService lookups;
    private Logger log;
    private Handler handler;
    private final List<String> infoLines = new ArrayList<>();

    @BeforeEach
    void setUp() {
        now = 0;
        cache = new OwnerCache(() -> now);
        lookups = Executors.newSingleThreadExecutor();
        log = Logger.getLogger("blockowner-overlay-test");
        log.setUseParentHandlers(false);
        log.setLevel(Level.ALL);
        handler = new Handler() {
            @Override
            public void publish(LogRecord record) {
                if (record.getLevel() == Level.INFO) {
                    infoLines.add(record.getMessage());
                }
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        };
        log.addHandler(handler);
    }

    @AfterEach
    void tearDown() {
        log.removeHandler(handler);
        lookups.shutdownNow();
    }

    /** A service whose CoreProtect answers nothing, on the same fake clock as the cache. */
    private OwnerQueryService emptyCoreProtect() {
        return service((w, cx, cz) -> NOTHING);
    }

    private OwnerQueryService service(dev.geldar.core.blockowner.OwnerSource source) {
        return new OwnerQueryService(source, cache, lookups, 1_000, log, () -> now);
    }

    private static Answer await(OwnerQueryService service) throws Exception {
        return service.answer(WORLD, 0, 0).get(5, TimeUnit.SECONDS);
    }

    @Test
    void aPlacementMissedByCoreProtectIsCountedOnceAndLogged() throws Exception {
        OwnerQueryService service = emptyCoreProtect();
        cache.recordChange(new Pos(WORLD, 3, 64, 3), "tommy");
        cache.recordChange(new Pos(WORLD, 4, 64, 4), "tommy");

        now = 10_000;
        assertEquals(2, await(service).blocks().size());
        assertEquals(1, infoLines.size());
        assertTrue(infoLines.get(0).contains("did not report 2 placed block(s)"), infoLines.get(0));

        // Read again: the same two placements are the same misses, so nothing new is counted or logged.
        now = 11_000;
        assertEquals(2, await(service).blocks().size());
        assertEquals(1, infoLines.size());
    }

    @Test
    void aPlacementInsideTheGracePeriodIsNotCountedYet() throws Exception {
        OwnerQueryService service = emptyCoreProtect();
        cache.recordChange(new Pos(WORLD, 5, 64, 5), "tommy");

        now = OwnerCache.CHANGE_GRACE_MS - 1;
        await(service);
        assertTrue(infoLines.isEmpty());

        now = OwnerCache.CHANGE_GRACE_MS + 1_000;
        await(service);
        assertEquals(1, infoLines.size());
    }

    @Test
    void theMissLogIsRateLimitedToOneLinePerMinute() throws Exception {
        OwnerQueryService service = emptyCoreProtect();
        cache.recordChange(new Pos(WORLD, 3, 64, 3), "tommy");
        now = 10_000;
        await(service);
        assertEquals(1, infoLines.size());

        // A second miss inside the minute is counted, but it waits for the next line.
        now = 20_000;
        cache.recordChange(new Pos(WORLD, 5, 64, 5), "zack");
        now = 31_000;
        await(service);
        assertEquals(1, infoLines.size());
    }

    @Test
    void anExpiredOverlayIsNeitherServedNorCounted() throws Exception {
        OwnerQueryService service = emptyCoreProtect();
        cache.recordChange(new Pos(WORLD, 6, 64, 6), "tommy");

        now = OwnerCache.CHANGE_TTL_MS;
        Answer answer = await(service);

        assertTrue(answer.blocks().isEmpty(), "a change past its TTL must not still be laid over the answer");
        assertTrue(infoLines.isEmpty());
    }

    @Test
    void aChunkCoreProtectCouldNotAnswerIsNotCountedAsAMiss() throws Exception {
        OwnerQueryService failing = service((w, cx, cz) -> {
            throw new OwnerSource.Unavailable("CoreProtect is not installed");
        });
        cache.recordChange(new Pos(WORLD, 7, 64, 7), "tommy");

        now = 10_000;
        Answer answer = await(failing);

        assertTrue(answer.truncated(), "an unknown answer stays unknown");
        assertTrue(infoLines.isEmpty(), "CoreProtect did not answer; that is not a missed placement");
    }
}
