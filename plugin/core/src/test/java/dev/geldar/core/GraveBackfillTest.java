package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.geldar.core.GraveBackfill.SignSite;
import dev.geldar.core.blockowner.BlockOwnerPublisher;
import dev.geldar.core.blockowner.OwnerCache;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class GraveBackfillTest {
    private static final Logger LOG = Logger.getLogger("backfill-test");
    private static final String SYSTEM = PlacementRecorder.SYSTEM_OWNER;

    /** A gravestone: stone bricks at y 64 with its sign at y 65. */
    private static final SignSite GRAVE = new SignSite("world", 10, 65, 10, "STONE_BRICKS",
            List.of("Here lies", "ag_adam", "Day 3", "fell"));
    /** A grave-looking sign over dirt: no stone bricks under it, so it is not a gravestone. */
    private static final SignSite SIGN_OVER_DIRT = new SignSite("world", 20, 65, 20, "DIRT",
            List.of("Here lies", "ag_eve", "", ""));
    /** A player's sign over stone bricks that does not say "Here lies". */
    private static final SignSite PLAYER_SIGN = new SignSite("world", 30, 65, 30, "STONE_BRICKS",
            List.of("Welcome", "to the shop", "", ""));

    @Test
    void onlyAGraveSignOverStoneBricksIsRecorded() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();
        PlacementRecorder recorder = recorder(cache, coreProtect);

        int found = GraveBackfill.run(List.of(GRAVE, SIGN_OVER_DIRT, PLAYER_SIGN), recorder);

        assertEquals(1, found);
        assertEquals(Set.of(
                new OwnedBlock(10, 64, 10, SYSTEM),
                new OwnedBlock(10, 65, 10, SYSTEM)), GravestoneListenerTest.owned(cache, "world", 10, 64, 10));
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 20, 64, 20));
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 30, 64, 30));
        assertEquals(2, coreProtect.logged().size());
    }

    @Test
    void runningTwiceGivesTheSameOwners() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        PlacementRecorder recorder = recorder(cache, new LoggingCoreProtect());
        List<SignSite> sites = List.of(GRAVE, SIGN_OVER_DIRT, PLAYER_SIGN);

        int first = GraveBackfill.run(sites, recorder);
        Set<OwnedBlock> afterFirst = GravestoneListenerTest.owned(cache, "world", 10, 64, 10);
        int second = GraveBackfill.run(sites, recorder);

        assertEquals(1, first);
        assertEquals(first, second);
        assertEquals(afterFirst, GravestoneListenerTest.owned(cache, "world", 10, 64, 10));
    }

    @Test
    void aGraveWithNoLinesIsSkipped() {
        assertEquals(false, GraveBackfill.isGrave(new SignSite("world", 1, 65, 1, "STONE_BRICKS", List.of())));
    }

    private static PlacementRecorder recorder(OwnerCache cache, LoggingCoreProtect coreProtect) {
        return new PlacementRecorder(cache, new BlockOwnerPublisher(message -> {}, LOG), Optional.of(coreProtect),
                LOG);
    }
}
