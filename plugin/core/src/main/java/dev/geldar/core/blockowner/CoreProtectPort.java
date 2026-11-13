package dev.geldar.core.blockowner;

import java.util.List;

/**
 * The CoreProtect lookup the owner source needs, as plain rows. The real implementation is {@link CoreProtectApi};
 * the tests use a fake.
 */
public interface CoreProtectPort {
    /** One logged change: a place or a break at a position, by a user (a name starting with '#' is not a player). */
    record LogRow(String world, int x, int y, int z, boolean place, String user, boolean rolledBack) {}

    /**
     * The place and break rows of the columns around one chunk, newest first.
     *
     * @throws RuntimeException when the lookup fails or CoreProtect cannot answer
     */
    List<LogRow> rows(String world, int chunkX, int chunkZ);
}
