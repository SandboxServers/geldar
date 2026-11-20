package dev.geldar.core.provenance;

import dev.geldar.core.EventEnvelope;
import dev.geldar.core.blockowner.OwnerCache;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.Optional;

/**
 * The owner the plugin's cache holds for a block, read from the cache only (no CoreProtect call). Null when the chunk
 * is not in the cache, when the block is not owned, or when the owner is not a life id.
 */
public final class PriorOwner {
    private PriorOwner() {}

    public static String of(OwnerCache cache, Pos pos) {
        var chunk = OwnerCache.chunkOf(pos);
        Optional<Owners> base = cache.freshBase(chunk);
        if (base.isEmpty()) {
            return null;
        }
        for (OwnedBlock b : cache.withChanges(chunk, base.get()).blocks()) {
            if (b.x() == pos.x() && b.y() == pos.y() && b.z() == pos.z()) {
                return b.owner() != null && EventEnvelope.isLifeId(b.owner()) ? b.owner() : null;
            }
        }
        return null;
    }
}
