package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.OwnerCache.ChunkKey;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.List;
import org.junit.jupiter.api.Test;

class OwnerCacheTest {
    private static final String WORLD = "world";

    private long now;
    private final OwnerCache cache = new OwnerCache(() -> now);

    private static Owners owners(OwnedBlock... blocks) {
        return new Owners(List.of(blocks), false);
    }

    @Test
    void storedAnswerIsAHitWhileFresh() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        Owners stored = owners(new OwnedBlock(1, 64, 1, "alice"));

        cache.storeBase(key, stored);

        assertEquals(stored, cache.freshBase(key).orElseThrow());
    }

    @Test
    void storedAnswerExpiresAfterTheBaseTtl() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        cache.storeBase(key, owners());

        now = OwnerCache.BASE_TTL_MS - 1;
        assertTrue(cache.freshBase(key).isPresent());

        now = OwnerCache.BASE_TTL_MS;
        assertTrue(cache.freshBase(key).isEmpty());
    }

    @Test
    void leastRecentlyUsedChunkIsEvictedAtTheBound() {
        for (int i = 0; i <= OwnerCache.MAX_CHUNKS; i++) {
            cache.storeBase(new ChunkKey(WORLD, i, 0), owners());
        }

        // The first chunk stored was the least recently used, so it went when the bound was passed.
        assertTrue(cache.freshBase(new ChunkKey(WORLD, 0, 0)).isEmpty());
        assertTrue(cache.freshBase(new ChunkKey(WORLD, OwnerCache.MAX_CHUNKS, 0)).isPresent());
    }

    @Test
    void readingAChunkKeepsItFromBeingEvicted() {
        cache.storeBase(new ChunkKey(WORLD, 0, 0), owners());
        for (int i = 1; i < OwnerCache.MAX_CHUNKS; i++) {
            cache.storeBase(new ChunkKey(WORLD, i, 0), owners());
        }
        assertTrue(cache.freshBase(new ChunkKey(WORLD, 0, 0)).isPresent());

        cache.storeBase(new ChunkKey(WORLD, OwnerCache.MAX_CHUNKS, 0), owners());

        assertTrue(cache.freshBase(new ChunkKey(WORLD, 0, 0)).isPresent());
        assertTrue(cache.freshBase(new ChunkKey(WORLD, 1, 0)).isEmpty());
    }

    @Test
    void aBreakRecordedBeforeALookupFinishesIsStillLaidOver() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        Pos broken = new Pos(WORLD, 3, 64, 3);
        // The lookup started before the break, so its answer still lists alice's block.
        Owners lookupStartedEarlier = owners(new OwnedBlock(3, 64, 3, "alice"));

        cache.recordChange(broken, null);
        Owners merged = cache.withChanges(key, lookupStartedEarlier);

        assertTrue(merged.blocks().isEmpty());
        assertFalse(merged.truncated());
    }

    @Test
    void aPlaceRecordedBeforeALookupFinishesIsStillLaidOver() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        cache.recordChange(new Pos(WORLD, 4, 64, 4), "bob");

        Owners merged = cache.withChanges(key, owners());

        assertEquals(List.of(new OwnedBlock(4, 64, 4, "bob")), merged.blocks());
    }

    @Test
    void aLaterChangeToTheSameBlockWins() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        Pos pos = new Pos(WORLD, 5, 64, 5);
        cache.recordChange(pos, "alice");
        cache.recordChange(pos, null);

        assertTrue(cache.withChanges(key, owners()).blocks().isEmpty());
    }

    @Test
    void changesExpireAfterTheChangeTtl() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        cache.recordChange(new Pos(WORLD, 6, 64, 6), "carol");

        now = OwnerCache.CHANGE_TTL_MS - 1;
        assertEquals(1, cache.withChanges(key, owners()).blocks().size());

        now = OwnerCache.CHANGE_TTL_MS;
        assertTrue(cache.withChanges(key, owners()).blocks().isEmpty());
    }

    @Test
    void changesAreKeyedByTheirChunkAndWorld() {
        cache.recordChange(new Pos(WORLD, 20, 64, 20), "dave");

        assertTrue(cache.withChanges(new ChunkKey(WORLD, 0, 0), owners()).blocks().isEmpty());
        assertTrue(cache.withChanges(new ChunkKey("nether", 1, 1), owners()).blocks().isEmpty());
    }

    @Test
    void truncatedBaseStaysTruncatedUnderAChange() {
        ChunkKey key = new ChunkKey(WORLD, 0, 0);
        cache.recordChange(new Pos(WORLD, 7, 64, 7), "erin");

        Owners merged = cache.withChanges(key, new Owners(List.of(), true));

        assertTrue(merged.truncated());
        assertEquals(1, merged.blocks().size());
    }

    @Test
    void chunkOfUsesFloorDivisionForNegativeCoordinates() {
        assertEquals(new ChunkKey(WORLD, -1, -1), OwnerCache.chunkOf(new Pos(WORLD, -1, 0, -1)));
        assertEquals(new ChunkKey(WORLD, -1, 0), OwnerCache.chunkOf(new Pos(WORLD, -16, 0, 15)));
        assertEquals(new ChunkKey(WORLD, -2, 1), OwnerCache.chunkOf(new Pos(WORLD, -17, 0, 16)));
    }
}
