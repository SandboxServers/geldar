package dev.geldar.core.kino;

import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;

/** Reports block changes to the feed. MONITOR priority and read-only: it never changes an event. */
public final class KinoBlockListener implements Listener {
    private final KinoFeed feed;

    public KinoBlockListener(KinoFeed feed) {
        this.feed = feed;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onPlace(BlockPlaceEvent event) {
        if (!event.isCancelled()) {
            Block b = event.getBlockPlaced();
            feed.blockChanged(b.getWorld().getName(), b.getX(), b.getY(), b.getZ(), b.getBlockData().getAsString());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = false)
    public void onBreak(BlockBreakEvent event) {
        if (!event.isCancelled()) {
            Block b = event.getBlock();
            feed.blockChanged(b.getWorld().getName(), b.getX(), b.getY(), b.getZ(), "minecraft:air");
        }
    }
}