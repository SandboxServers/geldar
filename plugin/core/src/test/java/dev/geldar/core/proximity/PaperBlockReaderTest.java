package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Openable;
import org.junit.jupiter.api.Test;

/** The Paper reader against a fake world: it never loads a chunk, and an unloaded chunk throws (decision 0199). */
class PaperBlockReaderTest {
    /** Records what the reader asked for, so a test can see that no block was read from an unloaded chunk. */
    private static final class FakeWorld {
        final int minHeight;
        final int maxHeight;
        final Set<String> loadedChunks = new HashSet<>();
        final List<String> blockReads = new ArrayList<>();
        final List<String> chunkChecks = new ArrayList<>();
        Material material = Material.STONE;
        boolean collidable = true;
        boolean open;

        FakeWorld(int minHeight, int maxHeight) {
            this.minHeight = minHeight;
            this.maxHeight = maxHeight;
        }

        World asWorld() {
            return (World) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {World.class},
                    (proxy, method, args) -> switch (method.getName()) {
                        case "getMinHeight" -> minHeight;
                        case "getMaxHeight" -> maxHeight;
                        case "isChunkLoaded" -> {
                            String chunk = args[0] + "," + args[1];
                            chunkChecks.add(chunk);
                            yield loadedChunks.contains(chunk);
                        }
                        case "getBlockAt" -> {
                            blockReads.add(args[0] + "," + args[1] + "," + args[2]);
                            yield block();
                        }
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
        }

        private Block block() {
            BlockData data = blockData();
            return (Block) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Block.class},
                    (proxy, method, args) -> switch (method.getName()) {
                        case "getBlockData" -> data;
                        case "isCollidable" -> collidable;
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
        }

        private BlockData blockData() {
            return (BlockData) Proxy.newProxyInstance(getClass().getClassLoader(),
                    new Class<?>[] {BlockData.class, Openable.class},
                    (proxy, method, args) -> switch (method.getName()) {
                        case "getMaterial" -> material;
                        case "isOpen" -> open;
                        default -> throw new UnsupportedOperationException(method.getName());
                    });
        }
    }

    private static final String AIR = "minecraft:air";

    @Test
    void aSolidBlockInALoadedChunkIsReadWithItsIdAndSolidFlag() {
        FakeWorld fake = new FakeWorld(-64, 320);
        fake.loadedChunks.add("0,0");
        BlockProbe probe = new PaperBlockReader(fake.asWorld()).at(3, 70, 5);
        assertEquals(new BlockProbe("minecraft:stone", true, false), probe);
        assertEquals(List.of("3,70,5"), fake.blockReads);
    }

    @Test
    void anOpenDoorIsReadAsOpenAndNotSolid() {
        FakeWorld fake = new FakeWorld(-64, 320);
        fake.loadedChunks.add("0,0");
        fake.material = Material.OAK_DOOR;
        fake.collidable = false;
        fake.open = true;
        assertEquals(new BlockProbe("minecraft:oak_door", false, true),
                new PaperBlockReader(fake.asWorld()).at(1, 64, 1));
    }

    @Test
    void aCellBelowOrAboveTheWorldIsAirAndTouchesNoChunk() {
        FakeWorld fake = new FakeWorld(-64, 320);
        PaperBlockReader reader = new PaperBlockReader(fake.asWorld());
        assertEquals(new BlockProbe(AIR, false, false), reader.at(0, -65, 0));
        assertEquals(new BlockProbe(AIR, false, false), reader.at(0, 320, 0));
        assertTrue(fake.chunkChecks.isEmpty());
        assertTrue(fake.blockReads.isEmpty());
    }

    @Test
    void anUnloadedChunkThrowsAndReadsNoBlockAndLoadsNothing() {
        FakeWorld fake = new FakeWorld(-64, 320);
        PaperBlockReader reader = new PaperBlockReader(fake.asWorld());
        assertThrows(UnloadedBlock.class, () -> reader.at(0, 64, 0));
        assertEquals(List.of("0,0"), fake.chunkChecks);
        assertTrue(fake.blockReads.isEmpty(), "no block is read from an unloaded chunk");
    }

    @Test
    void aNegativeCoordinateIsInTheChunkBelowZero() {
        // Chunk x of -1 covers x from -16 to -1, so x=-1 and x=-16 are in chunk -1 and x=-17 is in chunk -2.
        FakeWorld fake = new FakeWorld(-64, 320);
        fake.loadedChunks.add("-1,-1");
        PaperBlockReader reader = new PaperBlockReader(fake.asWorld());
        assertEquals("minecraft:stone", reader.at(-1, 64, -1).id());
        assertEquals("minecraft:stone", reader.at(-16, 64, -16).id());
        assertThrows(UnloadedBlock.class, () -> reader.at(-17, 64, -1));
        assertFalse(fake.blockReads.contains("-17,64,-1"));
    }

    @Test
    void theBuildLimitIsTheWorldsMaxHeight() {
        assertEquals(320, new PaperBlockReader(new FakeWorld(-64, 320).asWorld()).buildLimit());
    }
}
