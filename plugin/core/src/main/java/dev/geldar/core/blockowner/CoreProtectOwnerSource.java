package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.CoreProtectPort.LogRow;
import java.util.List;

/** Owners of a chunk from CoreProtect's log: the port's rows resolved newest first by {@link FirstRowResolver}. */
public final class CoreProtectOwnerSource implements OwnerSource {
    private final CoreProtectPort port;

    public CoreProtectOwnerSource(CoreProtectPort port) {
        this.port = port;
    }

    @Override
    public Owners ownersInChunk(String world, int chunkX, int chunkZ) {
        List<LogRow> rows = port.rows(world, chunkX, chunkZ);
        if (rows == null) {
            throw new Unavailable("CoreProtect returned no rows for " + world);
        }
        return FirstRowResolver.resolve(rows, world, chunkX, chunkZ);
    }
}
