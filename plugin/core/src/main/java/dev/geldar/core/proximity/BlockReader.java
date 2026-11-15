package dev.geldar.core.proximity;

/**
 * Reads the block at an integer cell. The server thread implements it over chunk snapshots (decision 0199, step 5);
 * tests implement it over a map. Every call counts against the read caps in {@link MuffleConfig}.
 */
public interface BlockReader {
    /** The block at the cell whose minimum corner is (x, y, z). */
    BlockProbe at(int x, int y, int z);
}
