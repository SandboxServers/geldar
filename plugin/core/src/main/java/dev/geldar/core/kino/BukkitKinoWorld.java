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
    public List<EntityView> entitiesNear(double x, double z, int radiusChunks) {
        int cx = Math.floorDiv((int) Math.floor(x), 16);
        int cz = Math.floorDiv((int) Math.floor(z), 16);
        List<EntityView> out = new ArrayList<>();
        for (Entity e : world.getEntities()) {
            Location at = e.getLocation();
            if (Math.abs(Math.floorDiv(at.getBlockX(), 16) - cx) <= radiusChunks
                    && Math.abs(Math.floorDiv(at.getBlockZ(), 16) - cz) <= radiusChunks) {
                out.add(view(e));
            }
        }
        return out;
    }

    private EntityView view(Entity e) {
        Location at = e.getLocation();
        String agent = e instanceof Player p && isAgent.test(p.getName()) ? p.getName() : null;
        return new EntityView(e.getType().getKey().toString(), agent, at.getX(), at.getY(), at.getZ(),
                at.getYaw(), at.getPitch());
    }
}