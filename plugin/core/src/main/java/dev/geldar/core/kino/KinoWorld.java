package dev.geldar.core.kino;

import java.util.List;
import java.util.Optional;

/**
 * The read-only view of a world that the feed uses (decision 0075). There is deliberately no method that
 * loads, generates or changes anything: the feed asks {@link #isChunkLoaded} first and reads blocks only of
 * loaded chunks.
 */
public interface KinoWorld {
    /** One entity in view; {@code agentId} is null unless the entity is an agent. */
    record EntityView(String type, String agentId, double x, double y, double z, float yaw, float pitch) {}

    /** An agent's position. */
    record Position(double x, double y, double z) {}

    String name();

    boolean isChunkLoaded(int chunkX, int chunkZ);

    /** Lowest section y of the world (block min height divided by 16). */
    int minSectionY();

    /** Highest section y of the world, inclusive. */
    int maxSectionY();

    /** The block state, for example {@code minecraft:oak_log[axis=y]}. Called only inside a loaded chunk. */
    String blockState(int x, int y, int z);

    /** Where an online agent is; empty when it is offline. */
    Optional<Position> agentPosition(String agentId);

    /** The entities of one chunk: {@code total} in the chunk, and the views of at most {@code max} from index {@code from}. */
    record ChunkEntities(int total, List<EntityView> views) {}

    /**
     * Entities of one loaded chunk, read from index {@code from}, at most {@code max} of them (an unloaded chunk
     * has total 0). The feed bounds its per-tick work with {@code max}; an implementation must not look at more
     * than that many entities, and must never load the chunk.
     */
    ChunkEntities entitiesInChunk(int chunkX, int chunkZ, int from, int max);
}