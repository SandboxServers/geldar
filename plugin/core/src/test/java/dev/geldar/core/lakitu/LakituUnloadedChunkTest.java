package dev.geldar.core.lakitu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import java.util.Set;
import org.junit.jupiter.api.Test;

class LakituUnloadedChunkTest {
    /** A flat world: stone below y = 0, air above. {@code blockName} throws for an unloaded chunk. */
    private static LoadedWorld world(Set<Long> loaded) {
        return new LoadedWorld() {
            public String name() { return "world"; }
            public boolean isChunkLoaded(int cx, int cz) { return loaded.contains(key(cx, cz)); }
            public int minSectionY() { return -4; }
            public int maxSectionY() { return 19; }
            public String blockName(int x, int y, int z) {
                if (!loaded.contains(key(Math.floorDiv(x, 16), Math.floorDiv(z, 16)))) {
                    throw new AssertionError("block read in an unloaded chunk: the generating path was used");
                }
                return y < 0 ? "minecraft:stone" : "minecraft:air";
            }
        };
    }

    private static long key(int x, int z) { return ((long) x << 32) ^ (z & 0xffffffffL); }

    @Test
    void anUnloadedWorldReturnsZeroSectionsAndNeverReadsABlock() {
        ChunkReader.Result r = new ChunkReader(256).read(world(Set.of()), 0, 0, 0, 2);
        assertTrue(r.sections().isEmpty());
        assertEquals(25, r.skippedUnloaded());
        assertFalse(r.overloaded());
    }

    @Test
    void onlyLoadedChunksAreReadAndTheRestAreCounted() {
        ChunkReader.Result r = new ChunkReader(256).read(world(Set.of(key(0, 0), key(1, 0))), 8, 0, 8, 1);
        assertEquals(7, r.skippedUnloaded());
        // Section y -1 and -2 hold stone (y 0 is air only above; section 0 is all air and is not sent).
        assertEquals(4, r.sections().size());
        assertTrue(r.sections().stream().allMatch(s -> s.sectionY() < 0 && s.world().equals("world")));
    }

    @Test
    void indicesAre4096LittleEndianShortsInYZXOrder() {
        ChunkReader.Result r = new ChunkReader(256).read(world(Set.of(key(0, 0))), 0, 0, 0, 0);
        ChunkReader.Section s = r.sections().get(0);
        assertEquals(10924, s.indices().length());
        assertTrue(s.indices().endsWith("="));
        assertEquals(java.util.List.of("minecraft:stone"), s.palette());
        ByteBuffer b = ByteBuffer.wrap(Base64.getDecoder().decode(s.indices())).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(8192, b.capacity());
        assertEquals(0, b.getShort(2 * ((15 * 16 + 15) * 16 + 15)));
    }

    @Test
    void aReadOverTheSectionCapIsRefusedWholeNotTruncated() {
        Set<Long> all = Set.of(key(0, 0), key(1, 0));
        ChunkReader.Result r = new ChunkReader(3).read(world(all), 8, 0, 8, 1);
        assertTrue(r.overloaded());
        assertTrue(r.sections().isEmpty());
        assertFalse(new ChunkReader(4).read(world(all), 8, 0, 8, 1).overloaded());
    }
}
