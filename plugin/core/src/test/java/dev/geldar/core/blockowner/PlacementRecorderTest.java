package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class PlacementRecorderTest {
    private static final Logger LOG = Logger.getLogger("placement-test");

    @Test
    void aSystemPlacementRecordsTheOverlayAndLogsTheCoreProtectRow() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        List<String> sent = new ArrayList<>();
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG);
        FakeCoreProtectPort coreProtect = new FakeCoreProtectPort();
        PlacementRecorder recorder = new PlacementRecorder(cache, publisher, Optional.of(coreProtect), LOG);

        recorder.placedBySystem("world", 4, 64, 5, "STONE_BRICKS");
        publisher.flush();

        assertEquals(List.of("geldar-system world 4,64,5 STONE_BRICKS"), coreProtect.logged());
        assertEquals(List.of(new OwnedBlock(4, 64, 5, "geldar-system")), owned(cache, "world", 4, 64, 5));
        assertEquals(1, sent.size());
        assertTrue(sent.get(0).contains("geldar-system"));
    }

    @Test
    void withoutCoreProtectTheOverlayStillRecordsTheBlock() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(message -> {}, LOG);
        PlacementRecorder recorder = new PlacementRecorder(cache, publisher, Optional.empty(), LOG);

        recorder.placedBySystem("world", 4, 64, 5, "OAK_SIGN");

        assertEquals(List.of(new OwnedBlock(4, 64, 5, "geldar-system")), owned(cache, "world", 4, 64, 5));
    }

    @Test
    void aCoreProtectRefusalKeepsTheOverlayAndDoesNotThrow() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(message -> {}, LOG);
        FakeCoreProtectPort coreProtect = new FakeCoreProtectPort().refuseLogging();
        PlacementRecorder recorder = new PlacementRecorder(cache, publisher, Optional.of(coreProtect), LOG);

        recorder.placedBySystem("world", 4, 64, 5, "STONE_BRICKS");

        assertEquals(List.of(), coreProtect.logged());
        assertEquals(List.of(new OwnedBlock(4, 64, 5, "geldar-system")), owned(cache, "world", 4, 64, 5));
    }

    /** The owners the cache holds for the chunk of the position, with no CoreProtect base. */
    static List<OwnedBlock> owned(OwnerCache cache, String world, int x, int y, int z) {
        Owners answer = cache.withChanges(OwnerCache.chunkOf(new Pos(world, x, y, z)), new Owners(List.of(), false));
        return answer.blocks().stream().filter(b -> b.x() == x && b.y() == y && b.z() == z).toList();
    }
}
