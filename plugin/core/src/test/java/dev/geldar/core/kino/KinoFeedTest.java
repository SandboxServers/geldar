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
        assertEquals(81 * 5 * 4096, total);
        assertEquals(81 * 2, count("chunk_section"));
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
        assertEquals(2 * 2, count("chunk_section"));
        assertEquals(1, count("hello"));
        pumpAll(feed);
        assertEquals(2 * 2, count("chunk_section"));
    }

    @Test
    void onlyLoadedChunksProduceSectionsAndAirSectionsAreSkipped() {
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of(FakeWorld.key(0, 0), FakeWorld.key(1, 0))), sink, 1);
        feed.start("steve_bot");
        pumpAll(feed);
        // Target section 0; sections -2, -1 hold stone, 0, 1, 2 are air: two per loaded chunk.
        assertEquals(4, count("chunk_section"));
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
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of()), sink, 2);
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
}