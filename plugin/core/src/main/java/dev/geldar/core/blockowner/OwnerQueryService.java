package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.OwnerCache.ChunkKey;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import java.util.logging.Logger;

/**
 * Answers a chunk query from the cache or from the lookup executor, never on the calling thread. A lookup that fails,
 * is refused (the queue is full) or runs past the timeout answers an empty list with truncated set: the Body must not
 * read an empty list as "nothing here is owned", so truncated says the list is not known to be complete. A failure is
 * logged with its root cause through {@link LookupFailureLog}.
 */
public final class OwnerQueryService {
    /** One chunk's answer, as the reply carries it. */
    public record Answer(String world, int chunkX, int chunkZ, List<OwnedBlock> blocks, boolean truncated) {}

    static final Owners UNKNOWN = new Owners(List.of(), true);

    /** At most one "CoreProtect did not report" line in this many milliseconds. */
    static final long MISS_LOG_MS = 60_000L;

    private final OwnerSource source;
    private final OwnerCache cache;
    private final ExecutorService lookups;
    private final LookupFailureLog failures;
    private final Logger log;
    private final LongSupplier clockMs;
    private volatile long timeoutMs;
    private long nextMissLogAt;
    private int missedSinceLog;
    private volatile LookupDebugLog debug = LookupDebugLog.disabled();

    public OwnerQueryService(OwnerSource source, OwnerCache cache, ExecutorService lookups, long timeoutMs,
            Logger log) {
        this(source, cache, lookups, timeoutMs, log, System::currentTimeMillis);
    }

    OwnerQueryService(OwnerSource source, OwnerCache cache, ExecutorService lookups, long timeoutMs, Logger log,
            LongSupplier clockMs) {
        this.source = source;
        this.cache = cache;
        this.lookups = lookups;
        this.timeoutMs = timeoutMs;
        this.failures = new LookupFailureLog(log, clockMs);
        this.log = log;
        this.clockMs = clockMs;
    }

    /** Applies a new lookup timeout (the config reload). */
    public void setTimeoutMs(long ms) {
        timeoutMs = ms;
    }

    /** The debug log the overlay line goes to (the {@code blockowner.debug} switch). */
    void attachDebug(LookupDebugLog log) {
        debug = log;
    }

    /** The answer for one chunk; completes within the timeout whatever the source does. */
    public CompletableFuture<Answer> answer(String world, int chunkX, int chunkZ) {
        ChunkKey key = new ChunkKey(world, chunkX, chunkZ);
        CompletableFuture<Owners> base;
        try {
            base = CompletableFuture.supplyAsync(() -> load(key), lookups);
        } catch (RejectedExecutionException e) {
            failures.failed("the lookup queue is full", null);
            base = CompletableFuture.completedFuture(UNKNOWN);
        }
        return base.completeOnTimeout(UNKNOWN, timeoutMs, TimeUnit.MILLISECONDS)
                .exceptionally(e -> {
                    failures.failed("the lookup failed", e);
                    return UNKNOWN;
                })
                .thenApply(owners -> {
                    if (!owners.truncated()) {
                        noteMissed(key, cache.countMissedPlacements(key, owners));
                    }
                    Owners merged = cache.withChanges(key, owners);
                    if (debug.enabled()) {
                        debug.info("answer chunk " + chunkX + "," + chunkZ + " in " + world + ": owners from the base "
                                + owners.blocks().size() + ", net change from the overlay "
                                + (merged.blocks().size() - owners.blocks().size()) + ", answered "
                                + merged.blocks().size());
                    }
                    return new Answer(world, chunkX, chunkZ, merged.blocks(), merged.truncated());
                });
    }

    /**
     * Counts the placements the cache holds that CoreProtect's answer lacks, and logs the count at most once a minute.
     * The count names no player: it measures how often CoreProtect misses a placement the server saw.
     */
    private synchronized void noteMissed(ChunkKey key, int count) {
        if (count == 0) {
            return;
        }
        missedSinceLog += count;
        long now = clockMs.getAsLong();
        if (now < nextMissLogAt) {
            return;
        }
        log.info("CoreProtect did not report " + missedSinceLog + " placed block(s) the cache holds; last seen in "
                + key.world() + " chunk " + key.chunkX() + "," + key.chunkZ() + ". Lines are at most one a minute.");
        missedSinceLog = 0;
        nextMissLogAt = now + MISS_LOG_MS;
    }

    /** Runs on the lookup thread: the stored answer when it is fresh, else a new lookup. */
    private Owners load(ChunkKey key) {
        Optional<Owners> fresh = cache.freshBase(key);
        if (fresh.isPresent()) {
            return fresh.get();
        }
        Owners owners;
        try {
            owners = source.ownersInChunk(key.world(), key.chunkX(), key.chunkZ());
        } catch (OwnerSource.Unavailable e) {
            failures.failed(e.getMessage(), null);
            return UNKNOWN;
        }
        cache.storeBase(key, owners);
        return owners;
    }
}
