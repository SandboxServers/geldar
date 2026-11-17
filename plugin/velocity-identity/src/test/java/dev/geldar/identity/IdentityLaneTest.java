package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class IdentityLaneTest {
    @Test
    void anUnsetLaneIsTheAgentLane() {
        assertEquals(Optional.of(IdentityLane.AGENT), IdentityLane.parse(null));
    }

    @Test
    void theTwoLanesAreTheExactNames() {
        assertEquals(Optional.of(IdentityLane.AGENT), IdentityLane.parse("agent"));
        assertEquals(Optional.of(IdentityLane.HUMAN), IdentityLane.parse("human"));
    }

    @Test
    void anyOtherValueIsNoLaneSoTheGateIsRefused() {
        for (String value : new String[] {"", " ", "Human", "HUMAN", "agent ", " human", "both", "humans"}) {
            assertTrue(IdentityLane.parse(value).isEmpty(), "[" + value + "]");
        }
    }
}
