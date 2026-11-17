package dev.geldar.core.kino;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** A flat world: stone below y = 0, air above. Block reads in an unloaded chunk throw. */
final class FakeWorld implements KinoWorld {
    final Set<Long> loaded;
    Optional<Position> agent = Optional.of(new Position(8, 1, 8));
    final List<String> calls = new ArrayList<>();
    int reads;

    FakeWorld(Set<Long> loaded) {
        this.loaded = loaded;
    }

    static long key(int x, int z) {
        return ((long) x << 32) ^ (z & 0xffffffffL);
    }

    public String name() { return "world"; }
    public boolean isChunkLoaded(int cx, int cz) { calls.add("loaded"); return loaded.contains(key(cx, cz)); }
    public int minSectionY() { return -4; }
    public int maxSectionY() { return 19; }

    public String blockState(int x, int y, int z) {
        reads++;
        if (!loaded.contains(key(Math.floorDiv(x, 16), Math.floorDiv(z, 16)))) {
            throw new AssertionError("block read in an unloaded chunk");
        }
        return y < 0 ? "minecraft:stone" : "minecraft:air";
    }

    public Optional<Position> agentPosition(String id) { return agent; }

    /** Entities per chunk key; chunk (0, 0) holds a zombie and a player by default. */
    final java.util.Map<Long, List<EntityView>> entities = new java.util.HashMap<>();
    /** Entities handed out (that is, examined) since the last reset. */
    int examined;
    final Set<String> visited = new java.util.HashSet<>();

    {
        entities.put(key(0, 0), List.of(new EntityView("minecraft:zombie", null, 1, 2, 3, 90f, 0f),
                new EntityView("minecraft:player", "steve_bot", 8, 1, 8, -45f, 120f)));
    }

    public ChunkEntities entitiesInChunk(int cx, int cz, int from, int max) {
        if (!loaded.contains(key(cx, cz))) {
            return new ChunkEntities(0, List.of());
        }
        List<EntityView> all = entities.getOrDefault(key(cx, cz), List.of());
        int end = Math.min(all.size(), from + max);
        List<EntityView> part = from >= end ? List.of() : all.subList(from, end);
        examined += part.size();
        for (int i = 0; i < part.size(); i++) {
            visited.add(cx + ":" + cz + ":" + (from + i));
        }
        return new ChunkEntities(all.size(), part);
    }
}