package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class ChunkLookupCallTest {
    /** Positive and negative chunks on both axes: the centre must land in the chunk for every sign. */
    private static final int[][] CHUNKS = {{0, 0}, {1, 2}, {-1, -1}, {-3, 4}, {5, -6}};

    @Test
    void everyListIsNonNullAndMutableBecauseCoreProtectEditsThem() {
        ChunkLookupCall call = ChunkLookupCall.forChunk(3, -2);
        List<?>[] lists = {call.restrictUsers(), call.excludeUsers(), call.restrictBlocks(), call.excludeBlocks(),
            call.actions()};
        for (List<?> list : lists) {
            assertNotNull(list);
            // CoreProtect's processData calls removeIf on the action list; List.of throws even when nothing matches.
            assertDoesNotThrow(() -> list.removeIf(item -> false));
        }
    }

    @Test
    void actionListAsksForBreaksPlacesAndClicksSoANewerClickDecidesItsPosition() {
        // A click is a newer row at a position than the place under it; without it the older place wins.
        List<Integer> actions = ChunkLookupCall.forChunk(0, 0).actions();

        assertEquals(List.of(ChunkLookupCall.ACTION_BREAK, ChunkLookupCall.ACTION_PLACE, ChunkLookupCall.ACTION_CLICK),
                actions);
        assertEquals(0, ChunkLookupCall.ACTION_BREAK);
        assertEquals(1, ChunkLookupCall.ACTION_PLACE);
        assertEquals(2, ChunkLookupCall.ACTION_CLICK);
    }

    @Test
    void windowIsPositiveAndStartsAfterTheEpoch() {
        int seconds = ChunkLookupCall.forChunk(0, 0).seconds();

        assertTrue(seconds > 0, "the window is seconds back from now");
        assertTrue(Instant.now().getEpochSecond() - seconds > 0, "the window must not reach before the epoch");
    }

    @Test
    void centreIsInsideItsChunkForEveryAxisAndSign() {
        for (int[] chunk : CHUNKS) {
            ChunkLookupCall call = ChunkLookupCall.forChunk(chunk[0], chunk[1]);

            assertEquals(chunk[0], Math.floorDiv((int) call.centreX(), 16), "x of chunk " + chunk[0]);
            assertEquals(chunk[1], Math.floorDiv((int) call.centreZ(), 16), "z of chunk " + chunk[1]);
        }
    }

    @Test
    void radiusReachesEveryColumnOfTheChunkOnBothAxes() {
        for (int[] chunk : CHUNKS) {
            ChunkLookupCall call = ChunkLookupCall.forChunk(chunk[0], chunk[1]);
            int centreX = (int) call.centreX();
            int centreZ = (int) call.centreZ();

            for (int x = chunk[0] * 16; x < chunk[0] * 16 + 16; x++) {
                assertTrue(Math.abs(x - centreX) <= call.radius(), "column x=" + x + " is outside the radius");
            }
            for (int z = chunk[1] * 16; z < chunk[1] * 16 + 16; z++) {
                assertTrue(Math.abs(z - centreZ) <= call.radius(), "column z=" + z + " is outside the radius");
            }
        }
    }
}
