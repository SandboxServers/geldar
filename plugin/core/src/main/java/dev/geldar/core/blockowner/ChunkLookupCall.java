package dev.geldar.core.blockowner;

import java.util.ArrayList;
import java.util.List;

/**
 * The arguments of one CoreProtect performLookup for a chunk, built without any CoreProtect or Bukkit class so the
 * shape is unit tested. CoreProtect edits the action list it is given: its processData calls removeIf on it, and the
 * immutable List.of throws from removeIf on every call, so every list here is a fresh, mutable ArrayList. The empty
 * user and block lists are what CoreProtect substitutes for null, so passing them changes nothing else.
 */
record ChunkLookupCall(int seconds, List<String> restrictUsers, List<String> excludeUsers,
        List<Object> restrictBlocks, List<Object> excludeBlocks, List<Integer> actions, int radius,
        double centreX, double centreY, double centreZ) {

    /** CoreProtect's action ids: 0 is a break, 1 a place. */
    static final int ACTION_BREAK = 0;
    static final int ACTION_PLACE = 1;
    /** Ten years in seconds: the window is "seconds back" and every row of the columns is wanted. */
    static final int LOOKUP_SECONDS = 315_360_000;
    /** CoreProtect's radius is an inclusive square around the centre; 8 from the chunk middle covers its 16 columns. */
    static final int RADIUS = 8;
    static final int CENTRE_Y = 64;

    static ChunkLookupCall forChunk(int chunkX, int chunkZ) {
        return new ChunkLookupCall(LOOKUP_SECONDS, new ArrayList<>(), new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), new ArrayList<>(List.of(ACTION_BREAK, ACTION_PLACE)), RADIUS,
                chunkX * 16 + 8.0, CENTRE_Y, chunkZ * 16 + 8.0);
    }
}
