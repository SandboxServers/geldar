package dev.geldar.core.proximity;

import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Openable;

/**
 * The Paper side of {@link BlockReader}. It is used only on the server thread (the chat judge hops there, see
 * {@link ProximityChatListener}). It reads the block already in a loaded chunk and never loads one: an unloaded chunk
 * throws {@link UnloadedBlock}. Solid is {@link Block#isCollidable()} (Paper API 26.1.2); open is the
 * {@link Openable} state of a door, trapdoor or fence gate. Cells outside the world read as air.
 */
public final class PaperBlockReader implements BlockReader {
    private static final BlockProbe AIR = new BlockProbe("minecraft:air", false, false);

    private final World world;

    public PaperBlockReader(World world) {
        this.world = world;
    }

    @Override
    public BlockProbe at(int x, int y, int z) {
        if (y < world.getMinHeight() || y >= world.getMaxHeight()) {
            return AIR;
        }
        if (!world.isChunkLoaded(x >> 4, z >> 4)) {
            throw new UnloadedBlock();
        }
        Block block = world.getBlockAt(x, y, z);
        BlockData data = block.getBlockData();
        Material material = data.getMaterial();
        boolean open = data instanceof Openable openable && openable.isOpen();
        return new BlockProbe(material.getKey().toString(), block.isCollidable(), open);
    }

    @Override
    public int buildLimit() {
        return world.getMaxHeight();
    }
}
