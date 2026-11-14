package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.geldar.core.blockowner.BlockOwnerPublisher;
import dev.geldar.core.blockowner.OwnerCache;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class GravestoneListenerTest {
    private static final Logger LOG = Logger.getLogger("grave-test");

    @Test
    void aGravestoneRecordsTheStoneAndTheSignAsSystemOwned() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();
        PlacementRecorder recorder = new PlacementRecorder(
                cache, new BlockOwnerPublisher(message -> {}, LOG), Optional.of(coreProtect), LOG);

        GravestoneListener.recordGrave(recorder, "world", 10, 64, -3);

        Set<OwnedBlock> owned = owned(cache, "world", 10, 64, -3);
        assertEquals(Set.of(
                new OwnedBlock(10, 64, -3, PlacementRecorder.SYSTEM_OWNER),
                new OwnedBlock(10, 65, -3, PlacementRecorder.SYSTEM_OWNER)), owned);
        assertEquals(List.of(
                "geldar-system world 10,64,-3 STONE_BRICKS",
                "geldar-system world 10,65,-3 OAK_SIGN"), coreProtect.logged());
    }

    /** The owned blocks the cache holds for the chunk of the position. */
    static Set<OwnedBlock> owned(OwnerCache cache, String world, int x, int y, int z) {
        Owners answer = cache.withChanges(OwnerCache.chunkOf(new Pos(world, x, y, z)), new Owners(List.of(), false));
        return new HashSet<>(answer.blocks());
    }
}
