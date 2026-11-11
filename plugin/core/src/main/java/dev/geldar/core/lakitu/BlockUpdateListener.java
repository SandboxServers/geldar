package dev.geldar.core.lakitu;

import java.util.function.LongSupplier;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;

/**
 * Queues block changes for the feed. MONITOR priority and read-only: it only reads the event and never
 * changes it (invariant I2). A cancelled event did not change the world, so it is not queued.
 */
public final class BlockUpdateListener implements Listener {
    private final UpdateQueue queue;
    private final LongSupplier tick;

    public BlockUpdateListener(UpdateQueue queue, LongSupplier tick) {
        this.queue = queue;
        this.tick = tick;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onPlace(BlockPlaceEvent event) {
        if (!event.isCancelled()) {
            record(event.getBlockPlaced(), event.getBlockPlaced().getType().getKey().toString());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onBreak(BlockBreakEvent event) {
        if (!event.isCancelled()) {
            record(event.getBlock(), "minecraft:air");
        }
    }

    private void record(Block block, String state) {
        queue.offer(new UpdateQueue.BlockUpdate(
                tick.getAsLong(), block.getWorld().getName(), block.getX(), block.getY(), block.getZ(), state));
    }
}
