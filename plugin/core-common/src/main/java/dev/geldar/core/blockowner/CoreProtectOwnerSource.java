package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.CoreProtectPort.LogRow;
import java.util.List;

/**
 * Owners of a chunk from CoreProtect's log: the port's rows resolved newest first by {@link FirstRowResolver}. With
 * {@code blockowner.debug} on, one summary line per chunk: the raw row count, the rows kept for the chunk and the owners
 * produced.
 */
public final class CoreProtectOwnerSource implements OwnerSource {
    private final CoreProtectPort port;
    private final LookupDebugLog debug;

    public CoreProtectOwnerSource(CoreProtectPort port, LookupDebugLog debug) {
        this.port = port;
        this.debug = debug;
    }

    @Override
    public Owners ownersInChunk(String world, int chunkX, int chunkZ) {
        List<LogRow> rows = port.rows(world, chunkX, chunkZ);
        if (rows == null) {
            throw new Unavailable("CoreProtect returned no rows for " + world);
        }
        Owners owners = FirstRowResolver.resolve(rows, world, chunkX, chunkZ);
        if (debug.enabled()) {
            debug.info("summary chunk " + chunkX + "," + chunkZ + " in " + world + ": raw rows " + rows.size()
                    + ", kept for chunk " + FirstRowResolver.countInChunk(rows, world, chunkX, chunkZ)
                    + ", owners " + owners.blocks().size() + (owners.truncated() ? " (truncated)" : ""));
        }
        return owners;
    }
}
