package dev.geldar.core;

import dev.geldar.core.blockowner.OwnerSource;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

/**
 * The pure part of the gravestone backfill (decision 0195): which signs in loaded chunks are gravestones, and recording
 * them. A gravestone is a sign whose first line starts "Here lies" (the text {@link Gravestone#lines} writes) over stone
 * bricks; any other sign, including a player's sign that does not say "Here lies", is skipped.
 *
 * <p>A block is logged only when the owner source says it is unowned or owned by someone else. A block the system already
 * owns is skipped and counted as already recorded, so a rerun logs nothing new. A block whose owner is unknown is skipped
 * and counted as unknown, so a retry after CoreProtect recovers is safe.
 */
final class GraveBackfill {
    /** The first line of a gravestone's sign. */
    static final String GRAVE_TEXT = "Here lies";
    /** At most this many chunks are looked up in one run; the blocks of the rest are unknown and skipped. */
    static final int MAX_CHUNKS = 256;

    private GraveBackfill() {}

    /** One sign read from a loaded chunk: its position, the material name under it and its front lines. */
    record SignSite(String world, int x, int y, int z, String below, List<String> lines) {}

    /** The owner of one block as the owner source answers it; UNKNOWN means the block is skipped. */
    enum Answer { SYSTEM, OTHER, UNKNOWN }

    /** Who owns one block now. */
    interface Owners {
        Answer of(String world, int x, int y, int z);
    }

    /** One chunk, by world and chunk coordinates. */
    record ChunkRef(String world, int chunkX, int chunkZ) {}

    /**
     * What one run did: {@code graves} gravestones found; {@code recorded} of them with no unknown block (the reply's N);
     * {@code already} of them with both blocks already owned by the system (K); {@code unknown} blocks skipped for an
     * unknown owner; {@code logged} blocks logged by this run; {@code signs} signs read (M); {@code unchecked} chunks over
     * {@link #MAX_CHUNKS} that were not looked up.
     */
    record Tally(int graves, int recorded, int already, int unknown, int logged, int signs, int unchecked) {}

    static boolean isGrave(SignSite site) {
        return GravestoneListener.STONE_BRICKS.equals(site.below())
                && !site.lines().isEmpty()
                && site.lines().get(0).startsWith(GRAVE_TEXT);
    }

    /**
     * Records the gravestones among the signs, as {@link Owners} answers for their blocks. The stone is one block below
     * the sign, as {@link GravestoneListener} places it. Server thread only, as the recorder is.
     */
    static Tally run(List<SignSite> sites, PlacementRecorder placements, Owners owners, int unchecked) {
        int graves = 0;
        int recorded = 0;
        int already = 0;
        int unknown = 0;
        int logged = 0;
        for (SignSite site : sites) {
            if (!isGrave(site)) {
                continue;
            }
            graves++;
            int stoneY = site.y() - 1;
            Answer stone = owners.of(site.world(), site.x(), stoneY, site.z());
            Answer sign = owners.of(site.world(), site.x(), site.y(), site.z());
            int unknownHere = (stone == Answer.UNKNOWN ? 1 : 0) + (sign == Answer.UNKNOWN ? 1 : 0);
            unknown += unknownHere;
            if (stone == Answer.OTHER) {
                placements.placedBySystem(site.world(), site.x(), stoneY, site.z(), GravestoneListener.STONE_BRICKS);
                logged++;
            }
            if (sign == Answer.OTHER) {
                placements.placedBySystem(site.world(), site.x(), site.y(), site.z(), GravestoneListener.OAK_SIGN);
                logged++;
            }
            if (unknownHere == 0) {
                recorded++;
            }
            if (stone == Answer.SYSTEM && sign == Answer.SYSTEM) {
                already++;
            }
        }
        return new Tally(graves, recorded, already, unknown, logged, sites.size(), unchecked);
    }

    /** The distinct chunks that hold a gravestone's blocks, in the order the signs were read. */
    static List<ChunkRef> chunksOf(List<SignSite> sites) {
        Set<ChunkRef> chunks = new LinkedHashSet<>();
        for (SignSite site : sites) {
            if (isGrave(site)) {
                chunks.add(new ChunkRef(site.world(), site.x() >> 4, site.z() >> 4));
            }
        }
        return new ArrayList<>(chunks);
    }

    /**
     * Looks up each chunk with the owner source. Off the server thread: a source may block on I/O. A chunk whose lookup
     * fails is left out, so its blocks answer UNKNOWN.
     */
    static Map<ChunkRef, OwnerSource.Owners> lookUp(OwnerSource source, List<ChunkRef> chunks, Logger log) {
        Map<ChunkRef, OwnerSource.Owners> answered = new HashMap<>();
        for (ChunkRef chunk : chunks) {
            try {
                answered.put(chunk, source.ownersInChunk(chunk.world(), chunk.chunkX(), chunk.chunkZ()));
            } catch (RuntimeException e) {
                log.warning("gravestone backfill: owner lookup failed for chunk " + chunk.chunkX() + ","
                        + chunk.chunkZ() + " in " + chunk.world() + ": " + e.getMessage());
            }
        }
        return answered;
    }

    /**
     * The answers for the blocks of the looked-up chunks. A block in a chunk's list answers SYSTEM or OTHER by its owner.
     * A block not in the list answers OTHER (unowned) when the list is complete, and UNKNOWN when it is truncated or the
     * chunk was not looked up.
     */
    static Owners fromChunks(Map<ChunkRef, OwnerSource.Owners> answered) {
        return (world, x, y, z) -> {
            OwnerSource.Owners chunk = answered.get(new ChunkRef(world, x >> 4, z >> 4));
            if (chunk == null) {
                return Answer.UNKNOWN;
            }
            for (OwnedBlock block : chunk.blocks()) {
                if (block.x() == x && block.y() == y && block.z() == z) {
                    return PlacementRecorder.SYSTEM_OWNER.equals(block.owner()) ? Answer.SYSTEM : Answer.OTHER;
                }
            }
            return chunk.truncated() ? Answer.UNKNOWN : Answer.OTHER;
        };
    }

    /** The reply line the command sends after a run. */
    static String reply(Tally t) {
        StringBuilder line = new StringBuilder("Backfilled " + t.recorded() + " gravestone(s) (" + t.already()
                + " already recorded) from " + t.signs() + " sign(s) in loaded chunks.");
        if (t.unknown() > 0) {
            line.append(" Unknown owner, skipped ").append(t.unknown()).append(" block(s).");
        }
        if (t.unchecked() > 0) {
            line.append(" Truncated: ").append(t.unchecked()).append(" chunk(s) over ").append(MAX_CHUNKS)
                    .append(" not checked.");
        }
        return line.toString();
    }
}
