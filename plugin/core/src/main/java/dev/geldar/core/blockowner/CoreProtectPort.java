package dev.geldar.core.blockowner;

import java.util.List;

/**
 * The CoreProtect lookup the owner source needs, as plain rows. The real implementation is {@link CoreProtectApi};
 * the tests use a fake.
 */
public interface CoreProtectPort {
    /**
     * One logged change: a place or a break at a position, by a user (a name starting with '#' is not a player). block
     * is the block name of the logged block (such as farmland), or null when the row carries none.
     */
    record LogRow(String world, int x, int y, int z, boolean place, String user, boolean rolledBack, String block) {
        /** A row with no block name. */
        public LogRow(String world, int x, int y, int z, boolean place, String user, boolean rolledBack) {
            this(world, x, y, z, place, user, rolledBack, null);
        }
    }

    /**
     * The place and break rows of the columns around one chunk, newest first.
     *
     * @throws RuntimeException when the lookup fails or CoreProtect cannot answer
     */
    List<LogRow> rows(String world, int chunkX, int chunkZ);

    /**
     * Logs one placement by {@code user} at a position, as CoreProtect would log a player's place (decision 0195: the
     * gravestones are logged under the system owner so that they persist past the overlay's 60 s).
     *
     * @throws RuntimeException when the placement cannot be logged
     */
    void logPlacement(String user, String world, int x, int y, int z, String material);
}
