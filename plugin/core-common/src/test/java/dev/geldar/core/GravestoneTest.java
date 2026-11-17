package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class GravestoneTest {
    private enum B { AIR, STONE, WATER, LAVA, DIRT }

    /** A fake world: solid ground up to and including y=0, air above, with overrides. */
    private static final class Fake implements Gravestone.Grid {
        final Map<String, B> over = new HashMap<>();

        void set(int x, int y, int z, B b) {
            over.put(x + "," + y + "," + z, b);
        }

        B at(int x, int y, int z) {
            return over.getOrDefault(x + "," + y + "," + z, y <= 0 ? B.STONE : B.AIR);
        }

        public boolean isAir(int x, int y, int z) {
            return at(x, y, z) == B.AIR;
        }

        public boolean isSolid(int x, int y, int z) {
            B b = at(x, y, z);
            return b == B.STONE || b == B.DIRT;
        }

        public boolean isLiquid(int x, int y, int z) {
            B b = at(x, y, z);
            return b == B.WATER || b == B.LAVA;
        }
    }

    @Test
    void choosesTheDeathBlockWhenItIsSafe() {
        assertEquals(Optional.of(new Gravestone.Spot(5, 1, 5)), Gravestone.findSpot(new Fake(), 5, 1, 5));
    }

    @Test
    void movesOffAnOccupiedBlockAndNeverReplacesNonAir() {
        Fake w = new Fake();
        w.set(5, 1, 5, B.DIRT);
        Gravestone.Spot s = Gravestone.findSpot(w, 5, 1, 5).orElseThrow();
        assertFalse(s.x() == 5 && s.y() == 1 && s.z() == 5);
        assertTrue(w.isAir(s.x(), s.y(), s.z()));
    }

    @Test
    void refusesWhenEverythingIsWaterOrLava() {
        Fake w = new Fake();
        for (int x = -10; x <= 10; x++) {
            for (int z = -10; z <= 10; z++) {
                for (int y = 1; y <= 6; y++) {
                    w.set(x, y, z, (x + z) % 2 == 0 ? B.WATER : B.LAVA);
                }
            }
        }
        assertTrue(Gravestone.findSpot(w, 0, 3, 0).isEmpty());
    }

    @Test
    void neverStandsOnLiquidOrBesideIt() {
        Fake w = new Fake();
        w.set(0, 0, 0, B.WATER);
        w.set(1, 1, 0, B.LAVA);
        Gravestone.Spot s = Gravestone.findSpot(w, 0, 1, 0).orElseThrow();
        assertFalse(w.isLiquid(s.x(), s.y() - 1, s.z()));
        assertFalse(w.isLiquid(s.x() + 1, s.y(), s.z()) || w.isLiquid(s.x() - 1, s.y(), s.z())
                || w.isLiquid(s.x(), s.y(), s.z() + 1) || w.isLiquid(s.x(), s.y(), s.z() - 1));
    }

    @Test
    void refusesTheOnlyGroundBesideLiquid() {
        for (int[] d : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
            Fake w = new Fake();
            for (int x = -5; x <= 5; x++) {
                for (int z = -5; z <= 5; z++) {
                    for (int y = -8; y <= 0; y++) {
                        w.set(x, y, z, B.AIR);
                    }
                }
            }
            w.set(0, 0, 0, B.STONE);
            w.set(d[0], 1, d[1], B.LAVA);
            assertTrue(Gravestone.findSpot(w, 0, 1, 0).isEmpty());
        }
    }

    @Test
    void needsAirForTheSignAboveTheBase() {
        Fake w = new Fake();
        w.set(0, 2, 0, B.STONE);
        Gravestone.Spot s = Gravestone.findSpot(w, 0, 1, 0).orElseThrow();
        assertFalse(s.x() == 0 && s.y() == 1 && s.z() == 0);
    }

    @Test
    void prefersOpenAirOverACorridorEvenWhenFarther() {
        Fake w = new Fake();
        // The death block is walled on two sides (a doorway); the open block is one step away.
        w.set(1, 1, 0, B.STONE);
        w.set(-1, 1, 0, B.STONE);
        Gravestone.Spot s = Gravestone.findSpot(w, 0, 1, 0).orElseThrow();
        assertFalse(s.x() == 0 && s.z() == 0 && s.y() == 1);
    }

    @Test
    void searchStaysWithinTheRadius() {
        Fake w = new Fake();
        // Ground only exists far from the death point: the ground below the cell is air.
        for (int x = -10; x <= 10; x++) {
            for (int z = -10; z <= 10; z++) {
                for (int y = -8; y <= 0; y++) {
                    w.set(x, y, z, B.AIR);
                }
            }
        }
        assertTrue(Gravestone.findSpot(w, 0, 1, 0).isEmpty());
    }

    @Test
    void causeWordForEachClass() {
        assertEquals("slain", Gravestone.causeWord("ENTITY_ATTACK"));
        assertEquals("shot", Gravestone.causeWord("PROJECTILE"));
        assertEquals("drowned", Gravestone.causeWord("DROWNING"));
        assertEquals("fell", Gravestone.causeWord("FALL"));
        assertEquals("burned", Gravestone.causeWord("LAVA"));
        assertEquals("starved", Gravestone.causeWord("STARVATION"));
        assertEquals("other", Gravestone.causeWord("VOID"));
        assertEquals("other", Gravestone.causeWord(null));
    }

    @Test
    void linesCarryNameDayAndCause() {
        assertArrayEquals(new String[] {"Here lies", "ag_wren_02", "Day 3", "fell"},
                Gravestone.lines("ag_wren_02", 3, "fell"));
    }

    @Test
    void dayLineIsBlankWhenUnknownAndDayCountsFromOne() {
        assertEquals("", Gravestone.lines("ag_wren_02", 0, "fell")[2]);
        assertEquals(0, Gravestone.dayOf(-1));
        assertEquals(1, Gravestone.dayOf(0));
        assertEquals(2, Gravestone.dayOf(24_000));
    }

    @Test
    void longNameIsTruncatedAndMetaNameIsReplaced() {
        assertEquals(Gravestone.LINE_MAX, Gravestone.lines("ag_abcdefghijklmnopqrstuvwxyz", 1, "fell")[1].length());
        assertEquals("a traveller", Gravestone.lines("ag_observer_01", 1, "fell")[1]);
        assertEquals("a traveller", Gravestone.lines(null, 1, "fell")[1]);
    }

    @Test
    void noSignTextCarriesAMarkerWord() {
        for (String cause : new String[] {"ENTITY_ATTACK", "PROJECTILE", "DROWNING", "FALL", "FIRE", "STARVATION", "VOID", null}) {
            for (String line : Gravestone.lines("ag_kestrel_01", 12, Gravestone.causeWord(cause))) {
                assertFalse(Gravestone.MARKER_WORD.matcher(line).find(), line);
            }
        }
    }
}
