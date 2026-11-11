package dev.geldar.core.lakitu;

/**
 * The read-only view of a world that the feed uses. There is deliberately no method that loads, generates or
 * changes anything: the reader asks {@link #isChunkLoaded} first and reads blocks only of loaded chunks (I1).
 */
public interface LoadedWorld {
    String name();

    boolean isChunkLoaded(int chunkX, int chunkZ);

    /** Lowest section y of the world (block min height divided by 16). */
    int minSectionY();

    /** Highest section y of the world, inclusive. */
    int maxSectionY();

    /** The state name of the block, for example {@code minecraft:stone}. Called only inside a loaded chunk. */
    String blockName(int x, int y, int z);
}
