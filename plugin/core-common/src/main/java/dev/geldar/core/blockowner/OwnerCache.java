package dev.geldar.core.blockowner;

import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.LongSupplier;

/**
 * Per-chunk answers from CoreProtect, with a short TTL and a bound on the chunks held, plus the block changes this
 * plugin saw in the last minute. CoreProtect writes its log about every half second, so a block placed a moment ago
 * is only known from {@link #recordChange}; a change is laid over the stored answer when the answer is read, so a
 * lookup that started before the change cannot undo it. Thread-safe: the server thread records changes, the lookup
 * thread stores answers and the NATS side reads.
 */
public final class OwnerCache {
    public static final int MAX_CHUNKS = 128;
    public static final long BASE_TTL_MS = 30_000L;
    public static final long CHANGE_TTL_MS = 60_000L;
    /** CoreProtect writes about every half second, so a change younger than this may be missing from its answer. */
    public static final long CHANGE_GRACE_MS = 5_000L;
    private static final int CHUNK_SIZE = 16;

    /** A block position in a world. */
    public record Pos(String world, int x, int y, int z) {}

    /** A chunk of a world. */
    public record ChunkKey(String world, int chunkX, int chunkZ) {}

    private record Base(Owners owners, long expiresAt) {}

    /** One recorded change; {@code counted} is set once the change is known to be missing from CoreProtect's answer. */
    private record Change(String owner, long recordedAt, long expiresAt, boolean counted) {}

    private final LongSupplier clock;
    private final Map<ChunkKey, Base> bases = lru();
    private final Map<ChunkKey, Map<Pos, Change>> changes = lru();

    public OwnerCache(LongSupplier clockMillis) {
        this.clock = clockMillis;
    }

    /** The chunk a block position is in. */
    public static ChunkKey chunkOf(Pos p) {
        return new ChunkKey(p.world(), Math.floorDiv(p.x(), CHUNK_SIZE), Math.floorDiv(p.z(), CHUNK_SIZE));
    }

    /** The stored answer for a chunk while it is fresh; empty when it is missing or expired. */
    public synchronized Optional<Owners> freshBase(ChunkKey key) {
        Base base = bases.get(key);
        if (base == null || clock.getAsLong() >= base.expiresAt()) {
            return Optional.empty();
        }
        return Optional.of(base.owners());
    }

    /** Stores the answer a lookup just read for a chunk. */
    public synchronized void storeBase(ChunkKey key, Owners owners) {
        bases.put(key, new Base(owners, clock.getAsLong() + BASE_TTL_MS));
    }

    /** Records one block's new owner (null when cleared). Called on the server thread for each block change. */
    public synchronized void recordChange(Pos pos, String owner) {
        long now = clock.getAsLong();
        changes.computeIfAbsent(chunkOf(pos), k -> new HashMap<>())
                .put(pos, new Change(owner, now, now + CHANGE_TTL_MS, false));
    }

    /**
     * Counts the placements of a chunk that are still held, are older than the grace period and that the lookup's
     * answer does not hold, each one once. Those are placements CoreProtect did not report. Returns how many were
     * counted now.
     */
    public synchronized int countMissedPlacements(ChunkKey key, Owners base) {
        Map<Pos, Change> recent = changes.get(key);
        if (recent == null) {
            return 0;
        }
        long now = clock.getAsLong();
        int missed = 0;
        for (Map.Entry<Pos, Change> e : recent.entrySet()) {
            Change c = e.getValue();
            if (c.owner() == null || c.counted() || now >= c.expiresAt() || now - c.recordedAt() < CHANGE_GRACE_MS
                    || reports(base, e.getKey(), c.owner())) {
                continue;
            }
            e.setValue(new Change(c.owner(), c.recordedAt(), c.expiresAt(), true));
            missed++;
        }
        return missed;
    }

    private static boolean reports(Owners base, Pos pos, String owner) {
        for (OwnedBlock b : base.blocks()) {
            if (b.x() == pos.x() && b.y() == pos.y() && b.z() == pos.z()) {
                return owner.equals(b.owner());
            }
        }
        return false;
    }

    /**
     * The answer for a chunk with the recent changes laid over it. Expired changes are dropped. A chunk that was
     * truncated stays truncated, and its owned list is capped at {@link FirstRowResolver#MAX_BLOCKS}.
     */
    public synchronized Owners withChanges(ChunkKey key, Owners base) {
        Map<Pos, Change> recent = changes.get(key);
        if (recent == null) {
            return base;
        }
        long now = clock.getAsLong();
        recent.entrySet().removeIf(e -> now >= e.getValue().expiresAt());
        if (recent.isEmpty()) {
            changes.remove(key);
            return base;
        }
        Map<Pos, String> owners = new LinkedHashMap<>();
        for (OwnedBlock b : base.blocks()) {
            owners.put(new Pos(key.world(), b.x(), b.y(), b.z()), b.owner());
        }
        recent.forEach((pos, change) -> {
            if (change.owner() == null) {
                owners.remove(pos);
            } else {
                owners.put(pos, change.owner());
            }
        });
        List<OwnedBlock> blocks = new ArrayList<>();
        boolean truncated = base.truncated();
        for (Map.Entry<Pos, String> e : owners.entrySet()) {
            if (blocks.size() == FirstRowResolver.MAX_BLOCKS) {
                truncated = true;
                break;
            }
            Pos p = e.getKey();
            blocks.add(new OwnedBlock(p.x(), p.y(), p.z(), e.getValue()));
        }
        return new Owners(List.copyOf(blocks), truncated);
    }

    private static <K, V> Map<K, V> lru() {
        return new LinkedHashMap<>(16, 0.75f, true) {
            private static final long serialVersionUID = 1L;

            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > MAX_CHUNKS;
            }
        };
    }
}
