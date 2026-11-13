package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.CoreProtectPort.LogRow;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class FirstRowResolverTest {
    private static final String WORLD = "world";

    private static LogRow place(int x, int y, int z, String user) {
        return new LogRow(WORLD, x, y, z, true, user, false);
    }

    private static LogRow breakRow(int x, int y, int z, String user) {
        return new LogRow(WORLD, x, y, z, false, user, false);
    }

    /** Rows at distinct positions inside chunk (0,0): x and z cycle 0..15, y rises every 256 rows. */
    private static List<LogRow> distinctRows(int count) {
        List<LogRow> rows = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            rows.add(place(i % 16, i / 256 + 64, i / 16 % 16, "alice"));
        }
        return rows;
    }

    @Test
    void placeThenBreakLeavesNoOwner() {
        // Newest first: the break came after the place.
        List<LogRow> rows = List.of(breakRow(1, 64, 1, "alice"), place(1, 64, 1, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertTrue(owners.blocks().isEmpty());
        assertFalse(owners.truncated());
    }

    @Test
    void breakThenPlaceByAnotherPlayerGivesThePlacer() {
        // Newest first: bob placed it after alice broke her block.
        List<LogRow> rows = List.of(place(2, 70, 3, "bob"), breakRow(2, 70, 3, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertEquals(List.of(new OwnedBlock(2, 70, 3, "bob")), owners.blocks());
    }

    @Test
    void placeBreakPlaceGivesTheLastPlacer() {
        List<LogRow> rows = List.of(place(4, 60, 4, "carol"), breakRow(4, 60, 4, "bob"),
                place(4, 60, 4, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertEquals(List.of(new OwnedBlock(4, 60, 4, "carol")), owners.blocks());
    }

    @Test
    void rolledBackRowsAreIgnored() {
        // The newest row is a rolled-back break: it did not happen, so alice's place still stands.
        List<LogRow> rows = List.of(new LogRow(WORLD, 5, 64, 5, false, "bob", true),
                place(5, 64, 5, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertEquals(List.of(new OwnedBlock(5, 64, 5, "alice")), owners.blocks());
    }

    @Test
    void rolledBackPlaceIsIgnoredSoTheBreakBelowStillDecides() {
        List<LogRow> rows = List.of(new LogRow(WORLD, 6, 64, 6, true, "bob", true),
                breakRow(6, 64, 6, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertTrue(owners.blocks().isEmpty());
    }

    @Test
    void nonPlayerPlaceDecidesThePositionAsUnowned() {
        // A '#tnt' place is newer than alice's place: the block there is not alice's any more.
        List<LogRow> rows = List.of(place(7, 64, 7, "#tnt"), place(7, 64, 7, "alice"));

        Owners owners = FirstRowResolver.resolve(rows, WORLD, 0, 0);

        assertTrue(owners.blocks().isEmpty());
    }

    @Test
    void aNewerClickDecidesThePositionAsUnowned() {
        // Newest first: a click on alice's placed block is the newest row, so the position has no owner by the rule.
        List<LogRow> rows = List.of(new LogRow(WORLD, 9, 64, 9, false, "zack", false), place(9, 64, 9, "alice"));

        assertTrue(FirstRowResolver.resolve(rows, WORLD, 0, 0).blocks().isEmpty());
    }

    @Test
    void sameSecondRowsKeepTheOrderCoreProtectGave() {
        // Two rows in the same second carry no time order, so the resolver takes the first one as listed.
        List<LogRow> newestFirst = List.of(place(10, 64, 10, "bob"), place(10, 64, 10, "alice"));
        List<LogRow> reversed = List.of(place(10, 64, 10, "alice"), place(10, 64, 10, "bob"));

        assertEquals(List.of(new OwnedBlock(10, 64, 10, "bob")),
                FirstRowResolver.resolve(newestFirst, WORLD, 0, 0).blocks());
        assertEquals(List.of(new OwnedBlock(10, 64, 10, "alice")),
                FirstRowResolver.resolve(reversed, WORLD, 0, 0).blocks());
    }

    @Test
    void nonPlayerBreakIsNotAnOwner() {
        List<LogRow> rows = List.of(breakRow(8, 64, 8, "#creeper"));

        assertTrue(FirstRowResolver.resolve(rows, WORLD, 0, 0).blocks().isEmpty());
    }

    @Test
    void rowsInOtherWorldsAreIgnored() {
        List<LogRow> rows = List.of(new LogRow("nether", 1, 64, 1, true, "alice", false));

        assertTrue(FirstRowResolver.resolve(rows, WORLD, 0, 0).blocks().isEmpty());
    }

    @Test
    void chunkFilterHandlesNegativeCoordinates() {
        List<LogRow> rows = List.of(
                place(-1, 64, -1, "alice"),
                place(-16, 64, -16, "bob"),
                place(-17, 64, 0, "carol"),
                place(0, 64, 0, "dave"),
                place(-1, 64, 16, "erin"));

        // Chunk -1 covers x and z from -16 to -1.
        Owners owners = FirstRowResolver.resolve(rows, WORLD, -1, -1);

        assertEquals(List.of(new OwnedBlock(-1, 64, -1, "alice"), new OwnedBlock(-16, 64, -16, "bob")),
                owners.blocks());
        // Chunk -2 holds x = -17 only, and z = 0 is chunk 0.
        Owners other = FirstRowResolver.resolve(rows, WORLD, -2, 0);
        assertEquals(List.of(new OwnedBlock(-17, 64, 0, "carol")), other.blocks());
    }

    @Test
    void capOfOwnedBlocksSetsTruncated() {
        Owners owners = FirstRowResolver.resolve(distinctRows(FirstRowResolver.MAX_BLOCKS + 1), WORLD, 0, 0);

        assertEquals(FirstRowResolver.MAX_BLOCKS, owners.blocks().size());
        assertTrue(owners.truncated());
    }

    @Test
    void exactlyTheCapIsNotTruncated() {
        Owners owners = FirstRowResolver.resolve(distinctRows(FirstRowResolver.MAX_BLOCKS), WORLD, 0, 0);

        assertEquals(FirstRowResolver.MAX_BLOCKS, owners.blocks().size());
        assertFalse(owners.truncated());
    }
}
