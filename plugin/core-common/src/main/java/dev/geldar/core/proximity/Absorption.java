package dev.geldar.core.proximity;

/**
 * The muffled-hearing model of decision 0199 (steps 1, 2 and 3): effective distance through blocks, the hearing tier,
 * and the sealed-room penalty. Pure: blocks come only through {@link BlockReader}; no world, no Bukkit types.
 */
public final class Absorption {
    /** Two axes whose next cell boundaries lie within this many units of ray parameter t are tied (an edge or corner). */
    private static final double TIE_EPSILON = 1e-9;

    private Absorption() {
    }

    /**
     * The result of one ray. {@code distance} is the raw 3D distance from eye to eye plus the absorption of every
     * block the ray crosses. {@code cutShort} is true when the read budget stopped the ray before its end cell; the
     * caller treats that as the silent tier. {@code reads} is the number of blocks read.
     */
    public record Effective(double distance, boolean cutShort, int reads) {
    }

    /**
     * The sealed-room scan of one listener: {@code penalty} is {@link MuffleConfig#SEALED_PENALTY} or 0, and
     * {@code reads} is the number of blocks read to decide it. {@code truncated} is true when the read budget stopped
     * the scan before the build limit and no roof was found, so a spent line budget does not look like clear sky.
     * MH-3 must treat a truncated scan as silent when the line budget is spent.
     */
    public record Sealed(double penalty, int reads, boolean truncated) {
    }

    /**
     * Effective distance from the speaker's feet (sx, sy, sz) to the listener's feet (lx, ly, lz). Both rays start at
     * the eye ({@link MuffleConfig#EYE_HEIGHT} above the feet). The ray is walked cell by cell (3D DDA, Amanatides and
     * Woo). Cells are visited once each. Where two or three axes reach a cell boundary at the same point, the ray
     * passes exactly through an edge or corner, so the cells touched only at that corner (the other cells of the
     * 2x2 or 2x2x2 neighbourhood) are read too, each once, and every tied axis is then stepped together. The trace
     * is therefore the same in both directions. Endpoints exactly on a block boundary: no asymmetry was found in
     * 640,000 probed pairs (MH-2 verification); the guarantee is stated for interior endpoints only. The start and
     * end cells add their absorption only when solid. At most
     * {@code maxReads} blocks are read (the caller passes the per-ray cap or what the line budget has left). A read
     * that would go past it stops the ray, which reports cutShort. A non-finite coordinate returns infinite distance
     * and cutShort, which is the silent tier.
     */
    public static Effective effectiveDistance(
            double sx, double sy, double sz, double lx, double ly, double lz, BlockReader reader, int maxReads) {
        double x0 = sx;
        double y0 = sy + MuffleConfig.EYE_HEIGHT;
        double z0 = sz;
        double x1 = lx;
        double y1 = ly + MuffleConfig.EYE_HEIGHT;
        double z1 = lz;
        if (!Double.isFinite(x0 + y0 + z0 + x1 + y1 + z1)) {
            return new Effective(Double.POSITIVE_INFINITY, true, 0);
        }
        double dx = x1 - x0;
        double dy = y1 - y0;
        double dz = z1 - z0;
        double raw = Math.sqrt(dx * dx + dy * dy + dz * dz);

        int cx = floor(x0);
        int cy = floor(y0);
        int cz = floor(z0);
        int stepX = Integer.signum(floor(x1) - cx);
        int stepY = Integer.signum(floor(y1) - cy);
        int stepZ = Integer.signum(floor(z1) - cz);
        int remX = Math.abs(floor(x1) - cx);
        int remY = Math.abs(floor(y1) - cy);
        int remZ = Math.abs(floor(z1) - cz);
        Walk walk = new Walk(reader, maxReads);
        boolean first = true;
        while (true) {
            boolean last = remX + remY + remZ == 0;
            if (!walk.read(cx, cy, cz, first || last)) {
                return new Effective(raw + walk.absorbed, true, walk.reads);
            }
            first = false;
            if (last) {
                return new Effective(raw + walk.absorbed, false, walk.reads);
            }
            // Each axis's next boundary is computed from its current cell, never accumulated, so a shared corner is
            // evaluated the same way in both directions. An axis with no cells left is at infinity and never tied.
            double tX = remX > 0 ? nextBoundary(x0, cx, stepX, dx) : Double.POSITIVE_INFINITY;
            double tY = remY > 0 ? nextBoundary(y0, cy, stepY, dy) : Double.POSITIVE_INFINITY;
            double tZ = remZ > 0 ? nextBoundary(z0, cz, stepZ, dz) : Double.POSITIVE_INFINITY;
            double best = Math.min(tX, Math.min(tY, tZ));
            int tied = (tX - best <= TIE_EPSILON ? 1 : 0)
                    | (tY - best <= TIE_EPSILON ? 2 : 0)
                    | (tZ - best <= TIE_EPSILON ? 4 : 0);
            if (Integer.bitCount(tied) > 1) {
                // Corner-only cells: every proper non-empty subset of the tied axes, stepped from the current cell.
                for (int corner = 1; corner < tied; corner++) {
                    if ((corner & ~tied) != 0) {
                        continue;
                    }
                    int x = cx + ((corner & 1) != 0 ? stepX : 0);
                    int y = cy + ((corner & 2) != 0 ? stepY : 0);
                    int z = cz + ((corner & 4) != 0 ? stepZ : 0);
                    if (!walk.read(x, y, z, false)) {
                        return new Effective(raw + walk.absorbed, true, walk.reads);
                    }
                }
            }
            if ((tied & 1) != 0) {
                cx += stepX;
                remX--;
            }
            if ((tied & 2) != 0) {
                cy += stepY;
                remY--;
            }
            if ((tied & 4) != 0) {
                cz += stepZ;
                remZ--;
            }
        }
    }

    /**
     * The hearing tier (decision 0199, step 2). A cut-short ray is silent. Clear is at most {@link
     * MuffleConfig#CLEAR_LIMIT}; muffled runs to CLEAR_LIMIT + MARGIN inclusive; anything more is silent.
     */
    public static Tier tier(double effective, boolean cutShort) {
        return ProximityRule.tier(effective, cutShort, MuffleConfig.MARGIN);
    }

    /**
     * The sealed-room penalty (decision 0199, step 3): {@link MuffleConfig#SEALED_PENALTY} when a solid block lies above
     * the listener's cell before open sky, else 0. The scan starts at y + 1, stops below {@code buildLimit} (the first y
     * above the world) and reads at most {@code maxReads} cells: the caller passes {@link MuffleConfig#PER_RAY_READ_CAP}
     * or what the line budget has left. A roof past the read cap is not seen, so the penalty is 0, and the scan is
     * truncated when the budget ran out before the build limit. The reads are reported with the penalty.
     */
    public static Sealed sealedPenalty(int x, int y, int z, BlockReader reader, int buildLimit, int maxReads) {
        int reads = 0;
        for (int above = y + 1; above < buildLimit && reads < maxReads; above++) {
            BlockProbe block = reader.at(x, above, z);
            reads++;
            if (block.solid()) {
                return new Sealed(MuffleConfig.SEALED_PENALTY, reads, false);
            }
        }
        boolean truncated = reads >= maxReads && y + 1 + reads < buildLimit;
        return new Sealed(0.0, reads, truncated);
    }

    private static int floor(double value) {
        return (int) Math.floor(value);
    }

    /**
     * The ray parameter t (0 at the start, 1 at the end) where the ray reaches the boundary ahead of its current cell
     * along one axis. The boundary is a whole number, so the quotient is one exact expression of the start and delta.
     * Only called for an axis with cells left, so step is never 0.
     */
    private static double nextBoundary(double start, int cell, int step, double delta) {
        double boundary = step > 0 ? cell + 1 : cell;
        return (boundary - start) / delta;
    }

    /** The reads of one ray. Each read checks the budget first, so no read is made past it. */
    private static final class Walk {
        private final BlockReader reader;
        private final int maxReads;
        private int reads;
        private double absorbed;

        Walk(BlockReader reader, int maxReads) {
            this.reader = reader;
            this.maxReads = maxReads;
        }

        /**
         * Reads the cell (x, y, z). An edge cell (the start or the end of the ray) adds its absorption only when solid.
         * Returns false, reading nothing, when the budget is spent.
         */
        boolean read(int x, int y, int z, boolean edge) {
            if (reads >= maxReads) {
                return false;
            }
            BlockProbe block = reader.at(x, y, z);
            reads++;
            if (!edge || block.solid()) {
                absorbed += AbsorptionTable.of(block);
            }
            return true;
        }
    }
}
