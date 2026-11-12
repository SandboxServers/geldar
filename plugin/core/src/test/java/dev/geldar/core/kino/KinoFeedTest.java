package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class KinoFeedTest {
    private final List<String> out = new ArrayList<>();
    private final KinoSink sink = (agent, json) -> out.add(json);

    private void assertAllValid() {
        for (String m : out) {
            assertTrue(KinoSchemaCheck.errors(m).isEmpty(), m + " -> " + KinoSchemaCheck.errors(m));
        }
    }

    private long count(String type) {
        return out.stream().filter(m -> m.contains("\"type\":\"" + type + "\"")).count();
    }

    @Test
    void anUnloadedWorldSendsNoSectionAndNeverReadsABlock() {
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of()), sink, 2);
        assertTrue(feed.start("steve_bot"));
        assertEquals(0, count("chunk_section"));
        assertEquals(1, count("hello"));
        assertAllValid();
    }

    private void pumpAll(KinoFeed feed) {
        for (int i = 0; i < 2000; i++) {
            feed.pump();
        }
    }

    @Test
    void helloIsFollowedByTargetMovedSoFollowAndOrbitHaveAFocus() {
        new KinoFeed(new FakeWorld(Set.of()), sink, 1).start("steve_bot");
        assertTrue(out.get(0).contains("\"hello\""));
        assertTrue(out.get(1).contains("\"target_moved\""));
        assertAllValid();
    }

    @Test
    void theWindowIsReadOnlyWithinThePerTickBlockBudgetAndIsCompleteInTheEnd() {
        Set<Long> loaded = new java.util.HashSet<>();
        for (int x = -4; x <= 4; x++) {
            for (int z = -4; z <= 4; z++) {
                loaded.add(FakeWorld.key(x, z));
            }
        }
        FakeWorld w = new FakeWorld(loaded);
        KinoFeed feed = new KinoFeed(w, sink, 4, 8192);
        feed.start("steve_bot");
        assertEquals(0, w.reads, "start itself reads no block");
        int total = 0;
        for (int i = 0; i < 1000; i++) {
            int before = w.reads;
            feed.pump();
            assertTrue(w.reads - before <= 8192, "a pump read " + (w.reads - before));
            total += w.reads - before;
        }
        // Every window section (8 per column) is read once; a stone section open to the air above also reads its faces.
        assertTrue(total >= 81 * 8 * 4096 && total <= 81 * (8 * 4096 + 6 * 256), "read " + total);
        assertEquals(81, count("chunk_section"));
        assertAllValid();
    }

    @Test
    void manyResyncsWhileAWindowIsQueuedCollapseToOneMorePass() {
        FakeWorld w = new FakeWorld(Set.of(FakeWorld.key(0, 0)));
        KinoFeed feed = new KinoFeed(w, sink, 1);
        feed.start("steve_bot");
        for (int i = 0; i < 100; i++) {
            feed.start("steve_bot");
        }
        pumpAll(feed);
        assertEquals(2, count("chunk_section"));
        assertEquals(1, count("hello"));
        pumpAll(feed);
        assertEquals(2, count("chunk_section"));
    }

    @Test
    void onlyLoadedChunksProduceSectionsAndAirSectionsAreSkipped() {
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of(FakeWorld.key(0, 0), FakeWorld.key(1, 0))), sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        // Target section 0; section -1 holds stone (open to the air above), 0 to 6 are air: one per loaded chunk.
        assertEquals(2, count("chunk_section"));
        assertAllValid();
    }

    @Test
    void movingIntoANewChunkSendsTargetMovedAndOnlyTheNewChunks() {
        FakeWorld w = new FakeWorld(Set.of(FakeWorld.key(0, 0), FakeWorld.key(1, 0)));
        KinoFeed feed = new KinoFeed(w, sink, 1);
        feed.start("steve_bot");
        out.clear();
        feed.tick();
        assertEquals(0, count("target_moved"));
        assertEquals(1, count("entity_positions"));
        w.agent = java.util.Optional.of(new KinoWorld.Position(20, 1, 8));
        out.clear();
        feed.tick();
        assertEquals(1, count("target_moved"));
        assertEquals(0, count("chunk_section"));
        assertAllValid();
    }

    @Test
    void entityPositionsAndBlockUpdatesValidateAndPitchIsClamped() {
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of(FakeWorld.key(0, 0))), sink, 2);
        feed.start("steve_bot");
        feed.tick();
        feed.blockChanged("world", 3, 70, -5, "minecraft:oak_log[axis=y]");
        feed.blockChanged("world", 3000, 70, -5, "minecraft:stone");
        feed.blockChanged("other", 3, 70, -5, "minecraft:stone");
        assertEquals(1, count("block_update"));
        assertTrue(out.stream().anyMatch(m -> m.contains("\"pitch\":90.0")));
        assertAllValid();
    }

    @Test
    void anOfflineTargetStopsWithSessionEnded() {
        FakeWorld w = new FakeWorld(Set.of());
        KinoFeed feed = new KinoFeed(w, sink, 2);
        feed.start("steve_bot");
        w.agent = java.util.Optional.empty();
        feed.tick();
        assertTrue(out.get(out.size() - 1).contains("session_ended"));
        assertFalse(feed.isTarget("steve_bot"));
        assertFalse(new KinoFeed(w, sink, 2).start("steve_bot"));
        assertAllValid();
    }

    @Test
    void theKillSwitchSaysByeOnceThenPublishesNothing() {
        FakeWorld w = new FakeWorld(Set.of(FakeWorld.key(0, 0)));
        KinoFeed feed = new KinoFeed(w, sink, 1);
        feed.start("steve_bot");
        out.clear();
        feed.kill();
        feed.kill();
        assertEquals(1, out.size());
        assertTrue(out.get(0).contains("kill_switch"));
        feed.tick();
        feed.blockChanged("world", 1, 1, 1, "minecraft:stone");
        feed.stop("steve_bot", "unsubscribed");
        assertFalse(feed.start("steve_bot"));
        assertEquals(1, out.size());
        assertAllValid();
    }

    @Test
    void radiusIsClampedToTheSchemaRange() {
        new KinoFeed(new FakeWorld(Set.of()), sink, 99).start("steve_bot");
        assertTrue(out.get(0).contains("\"view_radius\":8"));
        out.clear();
        new KinoFeed(new FakeWorld(Set.of()), sink, 0).start("steve_bot");
        assertTrue(out.get(0).contains("\"view_radius\":1"));
        assertAllValid();
    }

    @Test
    void entityPositionsAreCappedAt256() {
        List<KinoWorld.EntityView> many = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            many.add(new KinoWorld.EntityView("minecraft:cow", null, i, 1, 1, 0f, 0f));
        }
        assertTrue(KinoSchemaCheck.errors(KinoMessages.entityPositions(many)).isEmpty());
    }

    @Test
    void aFullyBuriedStoneSectionIsNotPublished() {
        // Stone below y 200 and a ring of loaded chunks around the window: every window section is sealed by stone.
        Terrain world = new Terrain(
                square(2), (x, y, z) -> y < 200 ? "minecraft:stone" : "minecraft:air", new KinoWorld.Position(8, 40, 8));
        KinoFeed feed = new KinoFeed(world, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        assertEquals(0, count("chunk_section"));
        assertAllValid();
    }

    @Test
    void aSectionOfOpaqueLogsIsBuriedWhileLeavesAreSeeThrough() {
        Terrain logs = new Terrain(square(2), (x, y, z) -> y < 200 ? "minecraft:oak_log[axis=y]" : "minecraft:air",
                new KinoWorld.Position(8, 40, 8));
        KinoFeed feed = new KinoFeed(logs, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        assertEquals(0, count("chunk_section"));
        out.clear();
        Terrain leaves = new Terrain(square(2),
                (x, y, z) -> y < 200 ? "minecraft:oak_leaves[persistent=false]" : "minecraft:air",
                new KinoWorld.Position(8, 40, 8));
        feed = new KinoFeed(leaves, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        // Sections 1 to 8 of the nine chunks: leaves are never opaque, so none is sealed.
        assertEquals(72, count("chunk_section"));
        assertAllValid();
    }

    @Test
    void aSurfaceSectionIsPublished() {
        // Stone below y 64: section 3 has air straight above it, so the nine chunks of the window all send it.
        Terrain world = new Terrain(
                square(2), (x, y, z) -> y < 64 ? "minecraft:stone" : "minecraft:air", new KinoWorld.Position(8, 70, 8));
        KinoFeed feed = new KinoFeed(world, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        assertEquals(9, count("chunk_section"));
        assertEquals(9, out.stream().filter(m -> m.contains("\"section_y\":3,")).count());
        assertAllValid();
    }

    @Test
    void aSectionBesideACaveIsPublished() {
        // Stone below y 64 with one air cell at (0, 24, 8): it opens section 1 of chunk (0, 0) and the face of chunk (-1, 0).
        Terrain world = new Terrain(
                square(2),
                (x, y, z) -> y < 64 && !(x == 0 && y == 24 && z == 8) ? "minecraft:stone" : "minecraft:air",
                new KinoWorld.Position(8, 24, 8));
        KinoFeed feed = new KinoFeed(world, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        assertEquals(9 + 2, count("chunk_section"));
        assertEquals(2, out.stream().filter(m -> m.contains("\"section_y\":1,")).count());
        assertTrue(out.stream().anyMatch(m -> m.contains("\"chunk_x\":-1,") && m.contains("\"section_y\":1,")));
        assertAllValid();
    }

    /** Glass in every section: see-through, so never skipped; a section is always sent when its window holds it. */
    @Test
    void aVerticalMoveWithinTheChunkSendsOnlyTheSectionsThatEnterTheWindow() {
        Terrain world = new Terrain(square(1), (x, y, z) -> "minecraft:glass", new KinoWorld.Position(8, 8, 8));
        KinoFeed feed = new KinoFeed(world, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        // Target in section 0: window -1..6, eight sections in each of the nine chunks.
        assertEquals(72, count("chunk_section"));
        out.clear();
        world.at = new KinoWorld.Position(8, 24, 8);
        feed.tick();
        pumpAll(feed);
        // Section 1: window 0..7, so only section 7 is new, once per chunk; nothing is re-sent.
        assertEquals(9, count("chunk_section"));
        assertEquals(9, out.stream().filter(m -> m.contains("\"section_y\":7,")).count());
        assertEquals(0, count("target_moved"));
        assertAllValid();
    }

    @Test
    void aVerticalMoveBackDoesNotResendSectionsStillInTheWindowButResendsEvictedOnes() {
        Terrain world = new Terrain(square(1), (x, y, z) -> "minecraft:glass", new KinoWorld.Position(8, 24, 8));
        KinoFeed feed = new KinoFeed(world, sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        // Section 1 has window 0..7: section 7 is new there and section -1 has left the window (it was evicted).
        out.clear();
        world.at = new KinoWorld.Position(8, 8, 8);
        feed.tick();
        pumpAll(feed);
        // Back in section 0: sections 0..6 are still in the window and are not sent again; section -1 left it, so it is.
        assertEquals(9, count("chunk_section"));
        assertEquals(9, out.stream().filter(m -> m.contains("\"section_y\":-1,")).count());
        assertAllValid();
    }

    private static Set<Long> square(int radius) {
        Set<Long> loaded = new java.util.HashSet<>();
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                loaded.add(FakeWorld.key(x, z));
            }
        }
        return loaded;
    }

    /** Block states by position. */
    private interface Blocks {
        String at(int x, int y, int z);
    }

    /** A world of the given blocks in the given loaded chunks; the agent stands at {@code at}. */
    private static final class Terrain implements KinoWorld {
        private final Set<Long> loaded;
        private final Blocks blocks;
        Position at;

        Terrain(Set<Long> loaded, Blocks blocks, Position at) {
            this.loaded = loaded;
            this.blocks = blocks;
            this.at = at;
        }

        public String name() {
            return "world";
        }

        public boolean isChunkLoaded(int cx, int cz) {
            return loaded.contains(FakeWorld.key(cx, cz));
        }

        public int minSectionY() {
            return -4;
        }

        public int maxSectionY() {
            return 19;
        }

        public String blockState(int x, int y, int z) {
            return blocks.at(x, y, z);
        }

        public java.util.Optional<Position> agentPosition(String agentId) {
            return java.util.Optional.of(at);
        }

        public ChunkEntities entitiesInChunk(int cx, int cz, int from, int max) {
            return new ChunkEntities(0, List.of());
        }
    }
}