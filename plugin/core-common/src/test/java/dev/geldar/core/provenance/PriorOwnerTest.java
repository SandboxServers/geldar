package dev.geldar.core.provenance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import dev.geldar.core.blockowner.OwnerCache;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.List;
import org.junit.jupiter.api.Test;

class PriorOwnerTest {
    private static final Pos CHEST = new Pos("world", 10, 64, -3);
    private final OwnerCache cache = new OwnerCache(() -> 1_000L);

    private void store(String owner) {
        cache.storeBase(
                OwnerCache.chunkOf(CHEST),
                new Owners(List.of(new OwnedBlock(10, 64, -3, owner, "chest")), false));
    }

    @Test
    void aCacheMissIsNull() {
        assertNull(PriorOwner.of(cache, CHEST));
    }

    @Test
    void anOwnedBlockGivesItsOwner() {
        store("ag_kestrel_01");
        assertEquals("ag_kestrel_01", PriorOwner.of(cache, CHEST));
    }

    @Test
    void aBlockNotInTheAnswerIsNull() {
        store("ag_kestrel_01");
        assertNull(PriorOwner.of(cache, new Pos("world", 11, 64, -3)));
    }

    @Test
    void aNonLifeOwnerIsNull() {
        store("Steve");
        assertNull(PriorOwner.of(cache, CHEST));
    }

    @Test
    void aChangeRecordedAfterTheBaseGivesTheChangedOwner() {
        store("ag_kestrel_01");
        cache.recordChange(CHEST, "ag_other_09");
        assertEquals("ag_other_09", PriorOwner.of(cache, CHEST));
    }

    @Test
    void theSameXAndZButAnotherYIsNull() {
        store("ag_kestrel_01");
        assertNull(PriorOwner.of(cache, new Pos("world", 10, 65, -3)));
    }

    @Test
    void theSameXAndYButAnotherZIsNull() {
        store("ag_kestrel_01");
        assertNull(PriorOwner.of(cache, new Pos("world", 10, 64, -2)));
    }
}
