package dev.geldar.core.proximity;

import java.util.HashMap;
import java.util.Map;

/** A block grid for the absorption tests: air everywhere except the cells that were set. */
final class ProbeWorld implements BlockReader {
    static final BlockProbe AIR = new BlockProbe("minecraft:air", false, false);

    private final Map<String, BlockProbe> cells = new HashMap<>();

    /** A solid, closed block with this id. */
    static BlockProbe solid(String id) {
        return new BlockProbe(id, true, false);
    }

    /** A solid block with this id in the given open state. */
    static BlockProbe state(String id, boolean open) {
        return new BlockProbe(id, true, open);
    }

    ProbeWorld set(int x, int y, int z, BlockProbe block) {
        cells.put(key(x, y, z), block);
        return this;
    }

    /** Sets the cells from x0 to x1 inclusive along the x axis at the given y and z. */
    ProbeWorld setRunX(int x0, int x1, int y, int z, BlockProbe block) {
        for (int x = x0; x <= x1; x++) {
            set(x, y, z, block);
        }
        return this;
    }

    @Override
    public BlockProbe at(int x, int y, int z) {
        return cells.getOrDefault(key(x, y, z), AIR);
    }

    private static String key(int x, int y, int z) {
        return x + "," + y + "," + z;
    }
}
