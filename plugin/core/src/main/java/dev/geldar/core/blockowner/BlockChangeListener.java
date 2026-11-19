package dev.geldar.core.blockowner;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import dev.geldar.core.blockowner.OwnerCache.ChunkKey;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.Optional;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import java.util.logging.Logger;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;

/**
 * Turns a player's place and break into an owner change: the cache learns it at once (CoreProtect's log lags), and the
 * change goes out on blockowner.changed. Only changes that were not cancelled count. Non-player changes (pistons,
 * explosions, fluids) are not seen here; CoreProtect's log has them, and the cache catches up when it is read again.
 * A break also sends its provenance (the breaker and the owner the cache knew before the break) when the flag is on.
 */
public final class BlockChangeListener implements Listener {
    /** Nulls are written out: a break with no prior owner sends "prior_owner":null, not no key at all. */
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private static final Logger LOG = Logger.getLogger(BlockChangeListener.class.getName());

    private final OwnerCache cache;
    private final BlockOwnerPublisher publisher;
    private final BooleanSupplier enabled;
    private final ProvenanceSink sink;
    private final BooleanSupplier provenanceEnabled;
    private final LongSupplier tick;

    public BlockChangeListener(OwnerCache cache, BlockOwnerPublisher publisher, BooleanSupplier enabled) {
        this(cache, publisher, enabled, null, () -> false, () -> 0L);
    }

    public BlockChangeListener(OwnerCache cache, BlockOwnerPublisher publisher, BooleanSupplier enabled,
            ProvenanceSink sink, BooleanSupplier provenanceEnabled, LongSupplier tick) {
        this.cache = cache;
        this.publisher = publisher;
        this.enabled = enabled;
        this.sink = sink;
        this.provenanceEnabled = provenanceEnabled;
        this.tick = tick;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        record(event.getBlockPlaced(), event.getPlayer().getName());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        Block block = event.getBlock();
        if (enabled.getAsBoolean() && sink != null && provenanceEnabled.getAsBoolean()) {
            try {
                sendBreakProvenance(event.getPlayer(), block);
            } catch (RuntimeException e) {
                // The break is the server's business: a failed provenance send must not skip the owner change.
                LOG.fine("break provenance not sent: " + e);
            }
        }
        record(block, null);
    }

    /** Server thread only. Read before {@link #record}, so the owner is the one the cache knew before the break. */
    private void sendBreakProvenance(Player player, Block block) {
        Pos pos = new Pos(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
        JsonObject json = new JsonObject();
        json.addProperty("kind", "break");
        json.addProperty("world", pos.world());
        json.addProperty("x", pos.x());
        json.addProperty("y", pos.y());
        json.addProperty("z", pos.z());
        json.addProperty("actor", player.getName());
        json.addProperty("prior_owner", priorOwner(cache, pos));
        json.addProperty("block", block.getType().getKey().getKey());
        json.addProperty("tick", tick.getAsLong());
        sink.send("break", GSON.toJson(json));
    }

    /** The owner the cache holds for {@code pos} right now, or null when it has none or the chunk is not fresh. */
    static String priorOwner(OwnerCache cache, Pos pos) {
        ChunkKey key = OwnerCache.chunkOf(pos);
        Optional<Owners> base = cache.freshBase(key);
        if (base.isEmpty()) {
            return null;
        }
        Owners owners = cache.withChanges(key, base.get());
        for (OwnedBlock b : owners.blocks()) {
            if (b.x() == pos.x() && b.y() == pos.y() && b.z() == pos.z()) {
                return b.owner();
            }
        }
        return null;
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
