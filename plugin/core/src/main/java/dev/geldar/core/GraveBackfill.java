package dev.geldar.core;

import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.List;

/**
 * The pure part of the gravestone backfill (decision 0195): which signs in loaded chunks are gravestones, and recording
 * them. A gravestone is a sign whose first line starts "Here lies" (the text {@link Gravestone#lines} writes) over stone
 * bricks; any other sign, including a player's sign that does not say "Here lies", is skipped.
 */
final class GraveBackfill {
    /** The first line of a gravestone's sign. */
    static final String GRAVE_TEXT = "Here lies";

    private GraveBackfill() {}

    /** One sign read from a loaded chunk: its position, the material name under it and its front lines. */
    record SignSite(String world, int x, int y, int z, String below, List<String> lines) {}

    static boolean isGrave(SignSite site) {
        return GravestoneListener.STONE_BRICKS.equals(site.below())
                && !site.lines().isEmpty()
                && site.lines().get(0).startsWith(GRAVE_TEXT);
    }

    /** Records every gravestone among the signs; returns how many were found. Running it again records them again. */
    static int run(List<SignSite> sites, PlacementRecorder placements) {
        int found = 0;
        for (SignSite site : sites) {
            if (isGrave(site)) {
                // The stone is one block below the sign, as GravestoneListener places it.
                GravestoneListener.recordGrave(placements, site.world(), site.x(), site.y() - 1, site.z());
                found++;
            }
        }
        return found;
    }
}
