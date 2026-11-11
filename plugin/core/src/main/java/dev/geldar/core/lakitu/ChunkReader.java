package dev.geldar.core.lakitu;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the chunk sections around a block position, loaded chunks only (invariant I1). An unloaded chunk is
 * skipped and counted. A section that is all air is not sent; the consumer treats an absent section as air.
 * A read that would exceed the section cap is refused whole ({@code overloaded}), never truncated silently.
 */
public final class ChunkReader {
    /** Sections read above and below the target's own section. */
    public static final int SECTIONS_BELOW = 2;

    public static final int SECTIONS_ABOVE = 2;
    private static final String AIR = "minecraft:air";

    private final int maxSections;

    public ChunkReader(int maxSections) {
        this.maxSections = maxSections;
    }

    /** One section, shaped like the schema's LakituChunkSection. */
    public record Section(String world, int sectionX, int sectionY, int sectionZ, List<String> palette, String indices) {}

    public record Result(List<Section> sections, int skippedUnloaded, boolean overloaded) {}

    public Result read(LoadedWorld world, int blockX, int blockY, int blockZ, int radiusChunks) {
        int cx = Math.floorDiv(blockX, 16);
        int cz = Math.floorDiv(blockZ, 16);
        int sy = Math.floorDiv(blockY, 16);
        int lo = Math.max(world.minSectionY(), sy - SECTIONS_BELOW);
        int hi = Math.min(world.maxSectionY(), sy + SECTIONS_ABOVE);
        List<Section> sections = new ArrayList<>();
        int skipped = 0;
        for (int x = cx - radiusChunks; x <= cx + radiusChunks; x++) {
            for (int z = cz - radiusChunks; z <= cz + radiusChunks; z++) {
                if (!world.isChunkLoaded(x, z)) {
                    skipped++;
                    continue;
                }
                for (int y = lo; y <= hi; y++) {
                    Section s = readSection(world, x, y, z);
                    if (s == null) {
                        continue;
                    }
                    if (sections.size() >= maxSections) {
                        return new Result(List.of(), skipped, true);
                    }
                    sections.add(s);
                }
            }
        }
        return new Result(List.copyOf(sections), skipped, false);
    }

    /** Encodes one section, or null when it is all air. Index order is (y * 16 + z) * 16 + x. */
    private static Section readSection(LoadedWorld world, int sx, int sy, int sz) {
        Map<String, Integer> palette = new LinkedHashMap<>();
        ByteBuffer out = ByteBuffer.allocate(4096 * 2).order(ByteOrder.LITTLE_ENDIAN);
        boolean allAir = true;
        for (int y = 0; y < 16; y++) {
            for (int z = 0; z < 16; z++) {
                for (int x = 0; x < 16; x++) {
                    String name = world.blockName(sx * 16 + x, sy * 16 + y, sz * 16 + z);
                    allAir &= AIR.equals(name);
                    out.putShort((short) palette.computeIfAbsent(name, k -> palette.size()).intValue());
                }
            }
        }
        if (allAir) {
            return null;
        }
        return new Section(world.name(), sx, sy, sz, List.copyOf(palette.keySet()),
                Base64.getEncoder().encodeToString(out.array()));
    }
}
