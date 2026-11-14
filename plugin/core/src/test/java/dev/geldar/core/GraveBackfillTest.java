package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.geldar.core.GraveBackfill.Answer;
import dev.geldar.core.GraveBackfill.ChunkRef;
import dev.geldar.core.GraveBackfill.Owners;
import dev.geldar.core.GraveBackfill.SignSite;
import dev.geldar.core.GraveBackfill.Tally;
import dev.geldar.core.blockowner.BlockOwnerPublisher;
import dev.geldar.core.blockowner.OwnerCache;
import dev.geldar.core.blockowner.OwnerSource;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class GraveBackfillTest {
    private static final Logger LOG = Logger.getLogger("backfill-test");
    private static final String SYSTEM = PlacementRecorder.SYSTEM_OWNER;
    private static final Owners UNOWNED = (world, x, y, z) -> Answer.OTHER;

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

        Tally tally = GraveBackfill.run(List.of(GRAVE, SIGN_OVER_DIRT, PLAYER_SIGN), recorder(cache, coreProtect),
                UNOWNED, 0);

        assertEquals(1, tally.graves());
        assertEquals(3, tally.signs());
        assertEquals(Set.of(
                new OwnedBlock(10, 64, 10, SYSTEM),
                new OwnedBlock(10, 65, 10, SYSTEM)), GravestoneListenerTest.owned(cache, "world", 10, 64, 10));
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 20, 64, 20));
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 30, 64, 30));
        assertEquals(2, coreProtect.logged().size());
    }

    @Test
    void aBlockAlreadyOwnedBySystemIsSkippedAndCounted() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();

        Tally tally = GraveBackfill.run(List.of(GRAVE), recorder(cache, coreProtect), (world, x, y, z) -> Answer.SYSTEM,
                0);

        assertEquals(List.of(), coreProtect.logged());
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 10, 64, 10));
        assertEquals(1, tally.graves());
        assertEquals(1, tally.recorded());
        assertEquals(1, tally.already());
        assertEquals(0, tally.logged());
    }

    @Test
    void anUnknownOwnerSkipsWithoutLogging() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();

        Tally tally = GraveBackfill.run(List.of(GRAVE), recorder(cache, coreProtect), (world, x, y, z) -> Answer.UNKNOWN,
                0);

        assertEquals(List.of(), coreProtect.logged());
        assertEquals(Set.of(), GravestoneListenerTest.owned(cache, "world", 10, 64, 10));
        assertEquals(0, tally.recorded());
        assertEquals(2, tally.unknown());
        assertEquals(0, tally.already());
    }

    @Test
    void anUnavailableSourceSkipsWithoutLogging() {
        OwnerSource down = (world, chunkX, chunkZ) -> {
            throw new OwnerSource.Unavailable("CoreProtect is not installed");
        };
        Map<ChunkRef, OwnerSource.Owners> answered = GraveBackfill.lookUp(down, List.of(new ChunkRef("world", 0, 0)),
                LOG);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();

        Tally tally = GraveBackfill.run(List.of(GRAVE), recorder(new OwnerCache(() -> 1_000L), coreProtect),
                GraveBackfill.fromChunks(answered), 0);

        assertEquals(List.of(), coreProtect.logged());
        assertEquals(2, tally.unknown());
        assertEquals(0, tally.recorded());
    }

    @Test
    void aFailingChunkLookupLeavesOnlyThatChunkUnknown() {
        OwnerSource oneFails = (world, chunkX, chunkZ) -> {
            if (chunkX == 1) {
                throw new OwnerSource.Unavailable("lookup timed out");
            }
            return new OwnerSource.Owners(List.of(), false);
        };

        Map<ChunkRef, OwnerSource.Owners> answered = GraveBackfill.lookUp(oneFails,
                List.of(new ChunkRef("world", 0, 0), new ChunkRef("world", 1, 0)), LOG);

        assertEquals(Set.of(new ChunkRef("world", 0, 0)), answered.keySet());
    }

    @Test
    void aSecondRunLogsNothingNew() {
        OwnerCache cache = new OwnerCache(() -> 1_000L);
        LoggingCoreProtect coreProtect = new LoggingCoreProtect();
        PlacementRecorder recorder = recorder(cache, coreProtect);
        List<SignSite> sites = List.of(GRAVE, SIGN_OVER_DIRT, PLAYER_SIGN);

        Tally first = GraveBackfill.run(sites, recorder, ownedIn(coreProtect), 0);
        Tally second = GraveBackfill.run(sites, recorder, ownedIn(coreProtect), 0);

        assertEquals(2, first.logged());
        assertEquals(2, coreProtect.logged().size());
        assertEquals(0, second.logged());
        assertEquals(1, second.already());
        assertEquals(1, second.recorded());
    }

    @Test
    void aChunkAnswerFollowsTheBlockWithNegativeCoordinates() {
        // -297 >> 4 is chunk -19 and 225 >> 4 is chunk 14: floor division, as the chunk of a negative block.
        OwnedBlock system = new OwnedBlock(-297, 61, 225, SYSTEM);
        OwnedBlock agent = new OwnedBlock(-297, 62, 225, "ag_zack_01");
        Map<ChunkRef, OwnerSource.Owners> answered = Map.of(new ChunkRef("world", -19, 14),
                new OwnerSource.Owners(List.of(system, agent), false));

        Owners owners = GraveBackfill.fromChunks(answered);

        assertEquals(Answer.SYSTEM, owners.of("world", -297, 61, 225));
        assertEquals(Answer.OTHER, owners.of("world", -297, 62, 225));
        assertEquals(Answer.OTHER, owners.of("world", -297, 63, 225));
        assertEquals(Answer.UNKNOWN, owners.of("other", -297, 61, 225));
        assertEquals(Answer.UNKNOWN, owners.of("world", 0, 61, 0));
    }

    @Test
    void aTruncatedChunkIsUnknownForABlockNotInItsList() {
        OwnedBlock system = new OwnedBlock(-297, 61, 225, SYSTEM);
        Owners owners = GraveBackfill.fromChunks(Map.of(new ChunkRef("world", -19, 14),
                new OwnerSource.Owners(List.of(system), true)));

        assertEquals(Answer.SYSTEM, owners.of("world", -297, 61, 225));
        assertEquals(Answer.UNKNOWN, owners.of("world", -297, 63, 225));
    }

    @Test
    void theChunksOfTheGravesAreListedOnce() {
        assertEquals(List.of(new ChunkRef("world", 0, 0)), GraveBackfill.chunksOf(List.of(GRAVE, SIGN_OVER_DIRT)));
    }

    @Test
    void theReplyNamesTheCountsUnknownAndTruncation() {
        assertEquals("Backfilled 2 gravestone(s) (1 already recorded) from 5 sign(s) in loaded chunks."
                + " Unknown owner, skipped 2 block(s). Truncated: 4 chunk(s) over 256 not checked.",
                GraveBackfill.reply(new Tally(3, 2, 1, 2, 0, 5, 4)));
        assertEquals("Backfilled 0 gravestone(s) (0 already recorded) from 0 sign(s) in loaded chunks.",
                GraveBackfill.reply(new Tally(0, 0, 0, 0, 0, 0, 0)));
    }

    /** Answers SYSTEM for a block the fake CoreProtect has logged as a system placement, OTHER for any other. */
    private static Owners ownedIn(LoggingCoreProtect coreProtect) {
        return (world, x, y, z) -> coreProtect.logged().stream()
                .anyMatch(line -> line.startsWith(SYSTEM + " " + world + " " + x + "," + y + "," + z + " "))
                ? Answer.SYSTEM
                : Answer.OTHER;
    }

    private static PlacementRecorder recorder(OwnerCache cache, LoggingCoreProtect coreProtect) {
        return new PlacementRecorder(cache, new BlockOwnerPublisher(message -> {}, LOG), Optional.of(coreProtect),
                LOG);
    }
}
