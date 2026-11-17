package dev.geldar.core.proximity;

/**
 * Reads the block at an integer cell. The server thread implements it over loaded chunks (decision 0199, step 5);
 * tests implement it over a map. Every call counts against the read caps in {@link MuffleConfig}.
 */
public interface BlockReader {
    /** The block at the cell whose minimum corner is (x, y, z). Throws {@link UnloadedBlock} for an unloaded chunk. */
    BlockProbe at(int x, int y, int z);

    /** The first y above the world (its build limit). The sealed-room scan stops there. */
    default int buildLimit() {
        return MuffleConfig.DEFAULT_BUILD_LIMIT;
    }
}
