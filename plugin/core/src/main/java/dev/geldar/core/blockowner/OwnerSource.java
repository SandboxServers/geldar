package dev.geldar.core.blockowner;

import java.util.List;

/**
 * Who placed the blocks that are in a chunk now. An implementation may block on I/O: callers run it off the server
 * thread.
 */
public interface OwnerSource {
    /** One block of a chunk that has an owner. */
    record OwnedBlock(int x, int y, int z, String owner) {}

    /** The owned blocks of one chunk. {@code truncated} is true when the chunk holds more than the list. */
    record Owners(List<OwnedBlock> blocks, boolean truncated) {}

    /**
     * The owned blocks of one chunk, at most {@link FirstRowResolver#MAX_BLOCKS} of them.
     *
     * @throws Unavailable when the source cannot answer; a caller must not read that as "no owners"
     */
    Owners ownersInChunk(String world, int chunkX, int chunkZ);

    /** The source cannot answer: CoreProtect is missing, disabled, too old, or the lookup failed. */
    final class Unavailable extends RuntimeException {
        private static final long serialVersionUID = 1L;

        public Unavailable(String message) {
            super(message);
        }

        public Unavailable(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
