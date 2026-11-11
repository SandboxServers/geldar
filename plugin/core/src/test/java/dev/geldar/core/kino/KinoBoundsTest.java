package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The per-tick work bounds of the feed: entities examined and blocks read, however crowded the world. */
class KinoBoundsTest {
    private final List<String> out = new ArrayList<>();
    private final KinoSink sink = (agent, json) -> out.add(json);

    private static Set<Long> window(int r) {
        Set<Long> loaded = new HashSet<>();
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                loaded.add(FakeWorld.key(x, z));
            }
        }
        return loaded;
    }

    private static List<KinoWorld.EntityView> crowd(int n, String type, double x0) {
        List<KinoWorld.EntityView> l = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            l.add(new KinoWorld.EntityView(type, null, x0 + i, 1, 1, 0f, 0f));
        }
        return l;
    }

    @Test
    void aWorldWithThousandsOfEntitiesCostsABoundedNumberOfExaminationsPerTick() {
        FakeWorld w = new FakeWorld(window(4));
        w.entities.put(FakeWorld.key(0, 0), crowd(5000, "minecraft:cow", 0));
        for (int x = -4; x <= 4; x++) {
            for (int z = -4; z <= 4; z++) {
                if (x != 0 || z != 0) {
                    w.entities.put(FakeWorld.key(x, z), crowd(40, "minecraft:sheep", 100_000 + x * 1000 + z * 50));
                }
            }
        }
        KinoFeed feed = new KinoFeed(w, sink, 4);
        feed.start("steve_bot");
        int ticks = 0;
        for (; ticks < 40; ticks++) {
            int before = w.examined;
            feed.tick();
            assertTrue(w.examined - before <= KinoFeed.ENTITY_EXAMINE_PER_TICK, "examined " + (w.examined - before));
            assertTrue(w.examined - before > 0);
        }
        assertEquals(40 * KinoFeed.ENTITY_EXAMINE_PER_TICK, w.examined, "a crowded window uses the whole budget");
    }

    @Test
    void theScanRotatesSoEveryEntityIsExaminedOverSeveralTicks() {
        FakeWorld w = new FakeWorld(window(1));
        w.entities.put(FakeWorld.key(0, 0), crowd(1500, "minecraft:cow", 0));
        w.entities.put(FakeWorld.key(1, 1), crowd(700, "minecraft:sheep", 10_000));
        KinoFeed feed = new KinoFeed(w, sink, 1);
        feed.start("steve_bot");
        int ticks = 0;
        while (w.visited.size() < 2200 && ticks < 10) {
            feed.tick();
            ticks++;
        }
        assertEquals(2200, w.visited.size(), "every entity was examined");
        assertTrue(ticks <= 5, "2200 entities are covered in at most 5 ticks, took " + ticks);
    }

    @Test
    void anAgentOtherThanTheTargetIsNotNamedInTheFeed() {
        FakeWorld w = new FakeWorld(window(1));
        w.entities.put(FakeWorld.key(0, 0), List.of(
                new KinoWorld.EntityView("minecraft:player", "steve_bot", 8, 1, 8, 0f, 0f),
                new KinoWorld.EntityView("minecraft:player", "other_bot", 9, 1, 9, 0f, 0f)));
        KinoFeed feed = new KinoFeed(w, sink, 1);
        feed.start("steve_bot");
        out.clear();
        feed.tick();
        String m = out.get(0);
        assertTrue(m.contains("steve_bot"));
        assertFalse(m.contains("other_bot"), m);
        assertTrue(KinoSchemaCheck.errors(m).isEmpty(), KinoSchemaCheck.errors(m).toString());
    }

    @Test
    void severalPanesResyncingAtOnceStayWithinTheBlockBudgetOfEveryTick() {
        FakeWorld w = new FakeWorld(window(4));
        KinoFeed feed = new KinoFeed(w, sink, 4);
        String[] ids = {"a_bot", "b_bot", "c_bot", "d_bot", "e_bot", "f_bot"};
        for (String id : ids) {
            feed.start(id);
        }
        assertEquals(0, w.reads, "start reads nothing");
        int total = 0;
        for (int tick = 0; tick < 400; tick++) {
            if (tick == 3 || tick == 7) {
                for (String id : ids) {
                    feed.start(id);
                }
            }
            int before = w.reads;
            feed.pump();
            int n = w.reads - before;
            assertTrue(n <= KinoFeed.BLOCK_BUDGET_PER_TICK, "tick " + tick + " read " + n);
            total += n;
        }
        assertTrue(total > 6 * 81 * 4096, "the resyncs were actually served, read " + total);
    }
}
