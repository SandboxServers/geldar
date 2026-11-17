package dev.geldar.core.lakitu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class LakituCapTest {
    private static PaneRegistry registry(int cap) {
        return new PaneRegistry(cap, 4, () -> 1_700_000_000_000L);
    }

    @Test
    void fourPanesAreAcceptedAndTheFifthIsRefusedWithoutAllocating() {
        PaneRegistry r = registry(4);
        for (int i = 0; i < 4; i++) {
            PaneRegistry.Opened o = r.open("ls_A", "agent_" + i, "follow", 4);
            assertNotNull(o.pane());
            assertNull(o.error());
            assertTrue(o.pane().paneId().matches("^pn_[0-9A-HJKMNP-TV-Z]{26}$"));
        }
        PaneRegistry.Opened fifth = r.open("ls_A", "agent_4", "follow", 4);
        assertNull(fifth.pane());
        assertEquals("pane_cap_reached", fifth.error());
        assertEquals(4, r.count("ls_A"));
        assertEquals(4, r.all().size());
    }

    @Test
    void aCapOfThreeStillRefusesTheFourthPane() {
        PaneRegistry r = registry(3);
        for (int i = 0; i < 3; i++) {
            assertNull(r.open("ls_A", "a" + i, "orbit", 2).error());
        }
        assertEquals("pane_cap_reached", r.open("ls_A", "a3", "orbit", 2).error());
    }

    @Test
    void theCapIsPerSessionAndClosingFreesASlot() {
        PaneRegistry r = registry(4);
        PaneRegistry.Pane first = null;
        for (int i = 0; i < 4; i++) {
            PaneRegistry.Pane p = r.open("ls_A", "a" + i, "free", 1).pane();
            first = first == null ? p : first;
        }
        assertNull(r.open("ls_B", "b0", "free", 1).error());
        assertEquals("pane_cap_reached", r.open("ls_A", "x", "free", 1).error());
        assertTrue(r.close("ls_A", first.paneId()));
        assertFalse(r.close("ls_A", first.paneId()));
        assertNull(r.open("ls_A", "x", "free", 1).error());
        assertEquals("pane_cap_reached", r.open("ls_A", "y", "free", 1).error());
    }

    @Test
    void theRadiusOfAPaneIsBoundedToTheConfiguredMaximum() {
        assertEquals(4, registry(4).open("ls_A", "a", "follow", 9).pane().radiusChunks());
        assertEquals(1, registry(4).open("ls_A", "a", "follow", 0).pane().radiusChunks());
    }
}
