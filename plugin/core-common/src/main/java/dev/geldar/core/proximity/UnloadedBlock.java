package dev.geldar.core.proximity;

/**
 * Thrown by a {@link BlockReader} for a cell in a chunk that is not loaded. The reader never forces a load; the
 * listener it was casting for is silent (decision 0199, step 5).
 */
public final class UnloadedBlock extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public UnloadedBlock() {
        super("chunk not loaded", null, false, false);
    }
}
