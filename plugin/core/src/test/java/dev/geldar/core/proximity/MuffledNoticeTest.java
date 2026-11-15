package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** The notice table: all eight compass points (speaker relative to the listener, north is -z) and the bands. */
class MuffledNoticeTest {
    @Test
    void eachOfTheEightPointsIsPinned() {
        // dx = speaker.x - listener.x, dz = speaker.z - listener.z
        assertEquals("n", MuffledNotice.direction(0, -1));
        assertEquals("ne", MuffledNotice.direction(1, -1));
        assertEquals("e", MuffledNotice.direction(1, 0));
        assertEquals("se", MuffledNotice.direction(1, 1));
        assertEquals("s", MuffledNotice.direction(0, 1));
        assertEquals("sw", MuffledNotice.direction(-1, 1));
        assertEquals("w", MuffledNotice.direction(-1, 0));
        assertEquals("nw", MuffledNotice.direction(-1, -1));
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
    }

    @Test
    void ofTakesTheDirectionFromTheListenerTowardTheSpeaker() {
        // Listener at (20, 0), speaker at (0, 0): the speaker is to the west of the listener.
        assertEquals("w", MuffledNotice.of(0, 0, 20, 0, 20).direction());
        assertEquals("far", MuffledNotice.of(0, 0, 20, 0, 20).band());
    }

    @Test
    void ofPointsNorthWhenTheSpeakerIsNorthOfTheListener() {
        // Listener at (0, 20), speaker at (0, 0): north is -z, so the voice comes from the north.
        assertEquals("n", MuffledNotice.of(0, 0, 0, 20, 20).direction());
    }

    @Test
    void ofPointsSouthWhenTheSpeakerIsSouthOfTheListener() {
        // Listener at (0, 0), speaker at (0, 20): south is +z, so the voice comes from the south.
        assertEquals("s", MuffledNotice.of(0, 20, 0, 0, 20).direction());
    }
}
