package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.CoreProtectPort.LogRow;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Resolves who placed each block that is there now, from CoreProtect's action log. CoreProtect keeps history, not
 * state, so the rows must come newest first and the first row seen for a position decides it: a place by a player
 * gives that player, and a break (or a place by a non-player such as '#tnt') gives no owner. Rolled-back rows are
 * skipped. Only rows inside the chunk are kept.
 */
public final class FirstRowResolver {
    /** The most owned blocks one answer carries. */
    public static final int MAX_BLOCKS = 4096;

    private static final String NON_PLAYER_PREFIX = "#";

    private FirstRowResolver() {}

    /** Resolves one chunk's owners from rows that are newest first. */
    public static Owners resolve(List<LogRow> newestFirst, String world, int chunkX, int chunkZ) {
        Set<Pos> decided = new HashSet<>();
        List<OwnedBlock> owned = new ArrayList<>();
        boolean truncated = false;
        for (LogRow row : newestFirst) {
            if (row.rolledBack() || !world.equals(row.world()) || !inChunk(row, chunkX, chunkZ)) {
                continue;
            }
            if (!decided.add(new Pos(row.x(), row.y(), row.z()))) {
                continue;
            }
            if (!row.place() || !isPlayer(row.user())) {
                continue;
            }
            if (owned.size() == MAX_BLOCKS) {
                truncated = true;
                break;
            }
            owned.add(new OwnedBlock(row.x(), row.y(), row.z(), row.user()));
        }
        return new Owners(List.copyOf(owned), truncated);
    }

    static boolean isPlayer(String user) {
        return user != null && !user.isEmpty() && !user.startsWith(NON_PLAYER_PREFIX);
    }

    private static boolean inChunk(LogRow row, int chunkX, int chunkZ) {
        return Math.floorDiv(row.x(), 16) == chunkX && Math.floorDiv(row.z(), 16) == chunkZ;
    }

    private record Pos(int x, int y, int z) {}
}
