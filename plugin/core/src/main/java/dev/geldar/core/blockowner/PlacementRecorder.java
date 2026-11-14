package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import java.util.Optional;
import java.util.logging.Logger;

/**
 * Records a block the plugin itself places (a gravestone, decision 0195) as owned by the system. The cache and the
 * change event make the owner live at once; the CoreProtect log keeps it after the overlay lapses (60 s). Without
 * CoreProtect only the overlay is recorded, so the block is protected for 60 s and then unowned. The failure of one
 * CoreProtect call never undoes the overlay. Server thread only.
 */
public final class PlacementRecorder {
    /** The owner of blocks the plugin places. No '#' (a non-player in CoreProtect) and a hyphen, per decision 0195. */
    public static final String SYSTEM_OWNER = "geldar-system";

    private final OwnerCache cache;
    private final BlockOwnerPublisher publisher;
    private final Optional<CoreProtectPort> coreProtect;
    private final Logger log;

    public PlacementRecorder(OwnerCache cache, BlockOwnerPublisher publisher, Optional<CoreProtectPort> coreProtect,
            Logger log) {
        this.cache = cache;
        this.publisher = publisher;
        this.coreProtect = coreProtect;
        this.log = log;
    }

    /** Records one block the plugin placed, with the material's name, as owned by {@link #SYSTEM_OWNER}. */
    public void placedBySystem(String world, int x, int y, int z, String material) {
        Pos pos = new Pos(world, x, y, z);
        cache.recordChange(pos, SYSTEM_OWNER);
        publisher.changed(pos, SYSTEM_OWNER);
        if (coreProtect.isEmpty()) {
            return;
        }
        try {
            coreProtect.get().logPlacement(SYSTEM_OWNER, world, x, y, z, material);
        } catch (RuntimeException e) {
            log.warning("CoreProtect did not log the system placement of " + material + " at " + x + "," + y + ","
                    + z + " in " + world + ": " + e.getMessage());
        }
    }
}
