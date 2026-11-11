package dev.geldar.core.lakitu;

import org.bukkit.World;

/** {@link LoadedWorld} over a Bukkit world. It calls getters only. */
public final class BukkitLoadedWorld implements LoadedWorld {
    private final World world;

    public BukkitLoadedWorld(World world) {
        this.world = world;
    }

    @Override
    public String name() {
        return world.getName();
    }

    @Override
    public boolean isChunkLoaded(int chunkX, int chunkZ) {
        return world.isChunkLoaded(chunkX, chunkZ);
    }

    @Override
    public int minSectionY() {
        return Math.floorDiv(world.getMinHeight(), 16);
    }

    @Override
    public int maxSectionY() {
        return Math.floorDiv(world.getMaxHeight() - 1, 16);
    }

    @Override
    public String blockName(int x, int y, int z) {
        return world.getBlockAt(x, y, z).getType().getKey().toString();
    }
}
