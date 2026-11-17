package dev.geldar.core.lakitu;

import dev.geldar.core.BoundedEventQueue;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Block changes waiting for the next frame, bounded at the per-frame update cap. When full the oldest entries
 * are dropped and counted ({@code dropped_updates}); the count is part of the frame's stats.
 */
public final class UpdateQueue {
    /** One change, shaped like the schema's LakituBlockUpdate. */
    public record BlockUpdate(long tick, String world, int x, int y, int z, String state) {}

    private final BoundedEventQueue<BlockUpdate> queue;

    public UpdateQueue(int bound) {
        this.queue = new BoundedEventQueue<>(bound);
    }

    public void offer(BlockUpdate update) {
        queue.offer(update);
    }

    /** Removes and returns everything queued, oldest first. */
    public List<BlockUpdate> drain() {
        List<BlockUpdate> out = new ArrayList<>();
        try {
            BlockUpdate u;
            while ((u = queue.poll(0, TimeUnit.MILLISECONDS)) != null) {
                out.add(u);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return out;
    }

    public int size() {
        return queue.size();
    }

    public long droppedUpdates() {
        return queue.dropped();
    }
}
