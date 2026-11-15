package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** The notice table: the eight compass points, overhead and below, the 1-block threshold and the bands. */
class MuffledNoticeTest {
    @Test
    void eachOfTheEightPointsIsPinned() {
        // dx = speaker.x - listener.x, dy = speaker.y - listener.y (zero here), dz = speaker.z - listener.z
        assertEquals("n", MuffledNotice.direction(0, 0, -1));
        assertEquals("ne", MuffledNotice.direction(1, 0, -1));
        assertEquals("e", MuffledNotice.direction(1, 0, 0));
        assertEquals("se", MuffledNotice.direction(1, 0, 1));
        assertEquals("s", MuffledNotice.direction(0, 0, 1));
        assertEquals("sw", MuffledNotice.direction(-1, 0, 1));
        assertEquals("w", MuffledNotice.direction(-1, 0, 0));
        assertEquals("nw", MuffledNotice.direction(-1, 0, -1));
    }

    @Test
    void aSpeakerDirectlyAboveOrLevelIsOverhead() {
        // Horizontal offset zero: dy >= 0 is overhead, dy = 0 included.
        assertEquals("overhead", MuffledNotice.direction(0, 3, 0));
        assertEquals("overhead", MuffledNotice.direction(0, 0, 0));
    }

    @Test
    void aSpeakerDirectlyBelowIsBelow() {
        assertEquals("below", MuffledNotice.direction(0, -3, 0));
        assertEquals("below", MuffledNotice.direction(0, -0.5, 0));
    }

    @Test
    void theOverheadThresholdIsUnderOneBlockOnEachHorizontalAxis() {
        // |dx| and |dz| just under 1 count as directly overhead, in either sign.
        assertEquals("overhead", MuffledNotice.direction(0.99, 5, 0));
        assertEquals("overhead", MuffledNotice.direction(-0.99, 5, 0));
        assertEquals("overhead", MuffledNotice.direction(0, 5, 0.99));
        assertEquals("overhead", MuffledNotice.direction(0, 5, -0.99));
        assertEquals("below", MuffledNotice.direction(0.99, -5, -0.99));
        // Exactly 1 block is a compass point, not overhead: the threshold is strict.
        assertEquals("e", MuffledNotice.direction(1.0, 5, 0));
        assertEquals("w", MuffledNotice.direction(-1.0, -5, 0));
        assertEquals("s", MuffledNotice.direction(0, 5, 1.0));
        assertEquals("n", MuffledNotice.direction(0, -5, -1.0));
        // Both axes must be under 1: one axis at 0.99 with the other at 1.0 is still a compass point.
        assertEquals("se", MuffledNotice.direction(0.99, 5, 1.0));
    }

    @Test
    void theBandsAreNearMidFarAtTheHearingSoundEdges() {
        assertEquals("near", MuffledNotice.band(0.5));
        assertEquals("near", MuffledNotice.band(8.0));
        assertEquals("mid", MuffledNotice.band(8.01));
        assertEquals("mid", MuffledNotice.band(16.0));
        assertEquals("far", MuffledNotice.band(16.01));
        assertEquals("far", MuffledNotice.band(24.0));
        assertEquals("far", MuffledNotice.band(32.0));
    }

    @Test
    void theJsonHasOnlyKindDirectionAndBand() {
        assertEquals("{\"kind\":\"heard_muffled\",\"direction\":\"w\",\"band\":\"far\"}",
                new MuffledNotice("w", "far").json());
        assertEquals("{\"kind\":\"heard_muffled\",\"direction\":\"overhead\",\"band\":\"near\"}",
                new MuffledNotice("overhead", "near").json());
    }

    @Test
    void ofTakesTheDirectionFromTheListenerTowardTheSpeaker() {
        // Listener at (20, 0), speaker at (0, 0): the speaker is to the west of the listener.
        assertEquals("w", MuffledNotice.of(0, 0, 20, 0, 0, 20).direction());
        assertEquals("far", MuffledNotice.of(0, 0, 20, 0, 0, 20).band());
    }

    @Test
    void ofPointsNorthWhenTheSpeakerIsNorthOfTheListener() {
        // Listener at (0, 20), speaker at (0, 0): north is -z, so the voice comes from the north.
        assertEquals("n", MuffledNotice.of(0, 0, 0, 20, 0, 20).direction());
    }

    @Test
    void ofPointsSouthWhenTheSpeakerIsSouthOfTheListener() {
        // Listener at (0, 0), speaker at (0, 20): south is +z, so the voice comes from the south.
        assertEquals("s", MuffledNotice.of(0, 20, 0, 0, 0, 20).direction());
    }

    @Test
    void ofIsOverheadWhenTheSpeakerIsDirectlyAboveTheListener() {
        // dy = speaker y minus listener y = +6: the speaker is above the listener.
        assertEquals("overhead", MuffledNotice.of(0.5, 0.5, 0.5, 0.5, 6, 6).direction());
        assertEquals("below", MuffledNotice.of(0.5, 0.5, 0.5, 0.5, -6, 6).direction());
    }
}
