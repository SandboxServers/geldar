package dev.geldar.core.proximity;

/**
 * The muffled-hearing model of decision 0199 (steps 1, 2 and 3): effective distance through blocks, the hearing tier,
 * and the sealed-room penalty. Pure: blocks come only through {@link BlockReader}; no world, no Bukkit types.
 */
public final class Absorption {
    private Absorption() {
    }

    /**
     * The result of one ray. {@code distance} is the raw 3D distance from eye to eye plus the absorption of every
     * block the ray crosses. {@code cutShort} is true when the read cap stopped the ray before its end cell; the
     * caller treats that as the silent tier. {@code reads} is the number of blocks read.
     */
    public record Effective(double distance, boolean cutShort, int reads) {
    }

    /**
     * Effective distance from the speaker's feet (sx, sy, sz) to the listener's feet (lx, ly, lz). Both rays start at
     * the eye ({@link MuffleConfig#EYE_HEIGHT} above the feet). The ray is walked cell by cell (3D DDA, Amanatides and
     * Woo). Cells are visited once each. The start and end cells add their absorption only when solid. A non-finite
     * coordinate returns infinite distance and cutShort, which is the silent tier.
     */
    public static Effective effectiveDistance(
            double sx, double sy, double sz, double lx, double ly, double lz, BlockReader reader) {
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
        double tMaxX = firstCrossing(x0, cx, stepX, dx);
        double tMaxY = firstCrossing(y0, cy, stepY, dy);
        double tMaxZ = firstCrossing(z0, cz, stepZ, dz);
        double tDeltaX = stepX == 0 ? Double.POSITIVE_INFINITY : 1.0 / Math.abs(dx);
        double tDeltaY = stepY == 0 ? Double.POSITIVE_INFINITY : 1.0 / Math.abs(dy);
        double tDeltaZ = stepZ == 0 ? Double.POSITIVE_INFINITY : 1.0 / Math.abs(dz);

        int reads = 0;
        double absorbed = 0.0;
        boolean first = true;
        while (true) {
            if (reads == MuffleConfig.PER_RAY_READ_CAP) {
                return new Effective(raw + absorbed, true, reads);
            }
            boolean last = remX + remY + remZ == 0;
            BlockProbe block = reader.at(cx, cy, cz);
            reads++;
            if (!(first || last) || block.solid()) {
                absorbed += AbsorptionTable.of(block);
            }
            first = false;
            if (last) {
                return new Effective(raw + absorbed, false, reads);
            }
            // Step across the nearest boundary among the axes that still have cells to cross (ties: x, then y, z).
            double best = Double.POSITIVE_INFINITY;
            int axis = -1;
            if (remX > 0 && tMaxX < best) {
                best = tMaxX;
                axis = 0;
            }
            if (remY > 0 && tMaxY < best) {
                best = tMaxY;
                axis = 1;
            }
            if (remZ > 0 && tMaxZ < best) {
                axis = 2;
            }
            if (axis == 0) {
                cx += stepX;
                remX--;
                tMaxX += tDeltaX;
            } else if (axis == 1) {
                cy += stepY;
                remY--;
                tMaxY += tDeltaY;
            } else {
                cz += stepZ;
                remZ--;
                tMaxZ += tDeltaZ;
            }
        }
    }

    /**
     * The hearing tier (decision 0199, step 2). A cut-short ray is silent. Clear is at most {@link
     * MuffleConfig#CLEAR_LIMIT}; muffled runs to CLEAR_LIMIT + MARGIN inclusive; anything more is silent.
     */
    public static Tier tier(double effective, boolean cutShort) {
        if (cutShort) {
            return Tier.SILENT;
        }
        if (effective <= MuffleConfig.CLEAR_LIMIT) {
            return Tier.CLEAR;
        }
        if (effective <= MuffleConfig.CLEAR_LIMIT + MuffleConfig.MARGIN) {
            return Tier.MUFFLED;
        }
        return Tier.SILENT;
    }

    /**
     * The sealed-room penalty (decision 0199, step 3): {@link MuffleConfig#SEALED_PENALTY} when a solid block lies
     * above the listener's cell before open sky, else 0. The scan starts at y + 1 and reads at most
     * {@link MuffleConfig#PER_RAY_READ_CAP} cells, stopping below {@link MuffleConfig#DEFAULT_BUILD_LIMIT}. A roof
     * past the read cap is not seen, so the penalty is 0.
     */
    public static double sealedPenalty(int x, int y, int z, BlockReader reader) {
        return sealedPenalty(x, y, z, reader, MuffleConfig.DEFAULT_BUILD_LIMIT);
    }

    /** As {@link #sealedPenalty(int, int, int, BlockReader)}, with the build limit (first y above the world) given. */
    public static double sealedPenalty(int x, int y, int z, BlockReader reader, int buildLimit) {
        int reads = 0;
        for (int above = y + 1; above < buildLimit && reads < MuffleConfig.PER_RAY_READ_CAP; above++) {
            BlockProbe block = reader.at(x, above, z);
            reads++;
            if (block.solid()) {
                return MuffleConfig.SEALED_PENALTY;
            }
        }
        return 0.0;
    }

    private static int floor(double value) {
        return (int) Math.floor(value);
    }

    /** The ray parameter t (0 at the start, 1 at the end) where it first leaves the start cell along one axis. */
    private static double firstCrossing(double start, int cell, int step, double delta) {
        if (step > 0) {
            return (cell + 1 - start) / delta;
        }
        if (step < 0) {
            return (start - cell) / -delta;
        }
        return Double.POSITIVE_INFINITY;
    }
}
