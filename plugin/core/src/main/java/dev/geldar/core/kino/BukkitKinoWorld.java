package dev.geldar.core.kino;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.util.BoundingBox;

/** {@link KinoWorld} over a Bukkit world. It calls getters only, on the server thread. */
public final class BukkitKinoWorld implements KinoWorld {
    private final Server server;
    private final World world;
    private final Predicate<String> isAgent;

    /** {@code isAgent} says whether a player name is an agent; other players carry no agent id. */
    public BukkitKinoWorld(Server server, World world, Predicate<String> isAgent) {
        this.server = server;
        this.world = world;
        this.isAgent = isAgent;
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
    public String blockState(int x, int y, int z) {
        return world.getBlockAt(x, y, z).getBlockData().getAsString();
    }

    @Override
    public Optional<Position> agentPosition(String agentId) {
        Player p = server.getPlayerExact(agentId);
        if (p == null || !p.getWorld().equals(world)) {
            return Optional.empty();
        }
        Location at = p.getLocation();
        return Optional.of(new Position(at.getX(), at.getY(), at.getZ()));
    }

    @Override
    public ChunkEntities entitiesInChunk(int chunkX, int chunkZ, int from, int max) {
        if (max <= 0 || !world.isChunkLoaded(chunkX, chunkZ)) {
            return new ChunkEntities(0, List.of());
        }
        // The chunk is loaded (checked above); a box query reads only entities that exist, it loads nothing. The
        // box also returns entities that straddle the border, so keep only those whose position is in this chunk.
        BoundingBox box = new BoundingBox(chunkX * 16.0, world.getMinHeight(), chunkZ * 16.0,
                chunkX * 16.0 + 16.0, world.getMaxHeight(), chunkZ * 16.0 + 16.0);
        List<Entity> eligible = new ArrayList<>();
        for (Entity e : world.getNearbyEntities(box)) {
            Location at = e.getLocation();
            if (Math.floorDiv(at.getBlockX(), 16) != chunkX || Math.floorDiv(at.getBlockZ(), 16) != chunkZ) {
                continue;
            }
            String name = e instanceof Player p ? p.getName() : null;
            if (KinoEntityPolicy.include(e.getType().getKey().toString(), name, isAgent)) {
                eligible.add(e);
            }
        }
        // Sorted by entity id so a page offset means the same entities on the next call.
        List<Entity> ordered = KinoEntityPolicy.orderedDistinct(eligible, Entity::getEntityId);
        int end = Math.min(ordered.size(), Math.max(0, from) + max);
        List<EntityView> out = new ArrayList<>();
        // Locations are read only for the page (at most max), never for the whole chunk.
        for (int i = Math.max(0, from); i < end; i++) {
            out.add(view(ordered.get(i)));
        }
        return new ChunkEntities(ordered.size(), out);
    }
    private EntityView view(Entity e) {
        Location at = e.getLocation();
        String agent = e instanceof Player p && isAgent.test(p.getName()) ? p.getName() : null;
        return new EntityView(e.getEntityId(), e.getType().getKey().toString(), agent, at.getX(), at.getY(), at.getZ(),
                at.getYaw(), at.getPitch());
    }
}