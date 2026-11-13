package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.logging.Logger;

/**
 * Queues each ownership change and sends at most {@link #PER_TICK} of them per server tick, so a big explosion cannot
 * flood NATS. A block that changes again before it is sent keeps one queued entry with the latest owner (coalesced).
 * When {@link #CAP} blocks are already waiting, a change for a new block is dropped and counted. Server thread only.
 */
public final class BlockOwnerPublisher {
    public static final int PER_TICK = 256;
    public static final int CAP = 16_384;

    private final Consumer<String> send;
    private final Logger log;
    private final int perTick;
    private final int cap;
    private final Map<Pos, String> pending = new LinkedHashMap<>();
    private long dropped;

    public BlockOwnerPublisher(Consumer<String> send, Logger log) {
        this(send, log, PER_TICK, CAP);
    }

    BlockOwnerPublisher(Consumer<String> send, Logger log, int perTick, int cap) {
        this.send = send;
        this.log = log;
        this.perTick = perTick;
        this.cap = cap;
    }

    /** Queues one change; {@code owner} is null when the ownership is cleared. */
    public void changed(Pos pos, String owner) {
        if (!pending.containsKey(pos) && pending.size() >= cap) {
            if (dropped == 0) {
                log.warning("Block owner changes exceed " + cap + " queued; dropping the rest");
            }
            dropped++;
            return;
        }
        pending.put(pos, owner);
    }

    /** Sends up to {@link #PER_TICK} queued changes; the rest wait for the next tick. */
    public void flush() {
        Iterator<Map.Entry<Pos, String>> it = pending.entrySet().iterator();
        int sent = 0;
        while (sent < perTick && it.hasNext()) {
            Map.Entry<Pos, String> e = it.next();
            it.remove();
            send.accept(BlockOwnerQueries.changedJson(e.getKey(), e.getValue()));
            sent++;
        }
    }

    int pendingCount() {
        return pending.size();
    }

    long droppedCount() {
        return dropped;
    }
}
