package dev.geldar.core.combat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.combat.EncounterTracker.Fact;
import dev.geldar.core.combat.EncounterTracker.Step;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class EncounterTrackerTest {
    private static final String LIFE = "ag_kestrel_01";
    private static final String OTHER = "ag_heron_02";
    private static final String PLAYER_UUID = "11111111-2222-3333-4444-555555555555";
    private static final String MOB = "0F8E2A3C-1B4D-4E5F-8A6B-7C8D9E0F1A2B";
    private static final String KEY = "enc:" + LIFE + ":0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b";

    private final EncounterTracker tracker = new EncounterTracker();

    private void hurt(String player, String mobUuid, long tick) {
        tracker.playerHurtByMob(player, PLAYER_UUID, mobUuid, "zombie", tick);
    }

    @Test
    void killGivesOneHostileKillWithTheLowercaseEncounterKey() {
        hurt(LIFE, MOB, 10);

        List<Fact> facts = tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 20);

        assertEquals(List.of(new Fact("hostile_kill", LIFE, "zombie", KEY)), facts);
        assertEquals(List.of(), tracker.advance(1000));
    }

    @Test
    void killWithoutPriorDamageOpensTheKillersEncounter() {
        List<Fact> facts = tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 20);

        assertEquals(List.of(new Fact("hostile_kill", LIFE, "zombie", KEY)), facts);
    }

    @Test
    void deathWithNoKillerClosesEveryEncounterAsSurvived() {
        hurt(LIFE, MOB, 10);
        hurt(OTHER, MOB, 11);

        List<Fact> facts = tracker.mobDied(MOB, "zombie", null, null, 20);

        assertEquals(
                List.of(
                        new Fact("fight_survived", LIFE, "zombie", KEY),
                        new Fact("fight_survived", OTHER, "zombie", "enc:" + OTHER + ":0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b")),
                facts);
    }

    @Test
    void timeoutFiresAfterMoreThan200TicksNotAt200() {
        hurt(LIFE, MOB, 0);

        assertEquals(List.of(), tracker.advance(200));
        assertEquals(List.of(new Fact("fight_survived", LIFE, "zombie", KEY)), tracker.advance(201));
        assertEquals(List.of(), tracker.advance(500));
    }

    @Test
    void multipleAttackersCreditOnlyTheKillerNotTheLastDamager() {
        hurt(LIFE, MOB, 1);
        hurt(OTHER, MOB, 2);

        List<Fact> facts = tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 3);

        assertEquals(
                List.of(
                        new Fact("hostile_kill", LIFE, "zombie", KEY),
                        new Fact("fight_survived", OTHER, "zombie", "enc:" + OTHER + ":0f8e2a3c-1b4d-4e5f-8a6b-7c8d9e0f1a2b")),
                facts);
    }

    @Test
    void perTickDamageKeepsOneEncounter() {
        for (long tick = 0; tick <= 50; tick++) {
            hurt(LIFE, MOB, tick);
        }

        assertEquals(List.of(new Fact("hostile_kill", LIFE, "zombie", KEY)), tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 51));
    }

    @Test
    void damageRefreshesTheTimeoutOfOneEncounter() {
        hurt(LIFE, MOB, 0);
        hurt(LIFE, MOB, 150);

        assertEquals(List.of(), tracker.advance(350));
        assertEquals(List.of(new Fact("fight_survived", LIFE, "zombie", KEY)), tracker.advance(351));
    }

    @Test
    void firstHitIsEngagedAndLaterHitsAreNot() {
        Optional<Step> first = tracker.playerHitMob(LIFE, PLAYER_UUID, MOB, "zombie", 5);
        Optional<Step> second = tracker.playerHitMob(LIFE, PLAYER_UUID, MOB, "zombie", 6);

        assertEquals(Optional.of(new Step("engaged", LIFE, "zombie")), first);
        assertFalse(second.isPresent());
    }

    @Test
    void playerDeathEmitsNothingForItsEncounters() {
        hurt(LIFE, MOB, 0);

        tracker.playerDied(LIFE, 10);

        assertEquals(List.of(), tracker.advance(1000));
        assertEquals(List.of(), tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 1000));
    }

    @Test
    void closedKeyIsNeverEmittedTwice() {
        hurt(LIFE, MOB, 0);
        assertEquals(1, tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 5).size());

        assertFalse(tracker.playerHitMob(LIFE, PLAYER_UUID, MOB, "zombie", 6).isPresent());
        assertEquals(List.of(), tracker.mobDied(MOB, "zombie", LIFE, PLAYER_UUID, 7));
        assertEquals(List.of(), tracker.advance(1000));
    }

    @Test
    void openEncountersAreCappedAndTheOldestIsDropped() {
        for (int i = 0; i <= EncounterTracker.MAX_OPEN; i++) {
            hurt(LIFE, String.format("00000000-0000-0000-0000-%012d", i), 0);
        }

        List<Fact> facts = tracker.advance(1000);

        assertEquals(EncounterTracker.MAX_OPEN, facts.size());
        assertTrue(facts.stream().noneMatch(f -> f.encounterKey().endsWith("-000000000000")));
    }

    @Test
    void recentlyClosedKeysStayClosedAfterMany() {
        for (int i = 0; i < 600; i++) {
            String mob = String.format("00000000-0000-0000-0000-%012d", i);
            hurt(LIFE, mob, 0);
            tracker.mobDied(mob, "zombie", LIFE, PLAYER_UUID, 1);
        }
        hurt(LIFE, String.format("00000000-0000-0000-0000-%012d", 599), 2);

        assertEquals(List.of(), tracker.mobDied(String.format("00000000-0000-0000-0000-%012d", 599), "zombie", LIFE, PLAYER_UUID, 3));
    }
}
