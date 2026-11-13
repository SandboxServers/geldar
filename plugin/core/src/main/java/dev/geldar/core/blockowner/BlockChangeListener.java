package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import java.util.function.BooleanSupplier;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;

/**
 * Turns a player's place and break into an owner change: the cache learns it at once (CoreProtect's log lags), and the
 * change goes out on blockowner.changed. Only changes that were not cancelled count. Non-player changes (pistons,
 * explosions, fluids) are not seen here; CoreProtect's log has them, and the cache catches up when it is read again.
 */
public final class BlockChangeListener implements Listener {
    private final OwnerCache cache;
    private final BlockOwnerPublisher publisher;
    private final BooleanSupplier enabled;

    public BlockChangeListener(OwnerCache cache, BlockOwnerPublisher publisher, BooleanSupplier enabled) {
        this.cache = cache;
        this.publisher = publisher;
        this.enabled = enabled;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        record(event.getBlockPlaced(), event.getPlayer().getName());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        record(event.getBlock(), null);
    }

    /** Server thread only. */
    void record(Block block, String owner) {
        if (!enabled.getAsBoolean()) {
            return;
        }
        Pos pos = new Pos(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
        cache.recordChange(pos, owner);
        publisher.changed(pos, owner);
    }
}
