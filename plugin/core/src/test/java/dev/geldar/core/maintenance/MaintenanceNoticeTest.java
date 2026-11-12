package dev.geldar.core.maintenance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

class MaintenanceNoticeTest {
    private static String notice(String kind, String scope, String extra) {
        return "{\"id\":\"deploy-1\",\"kind\":\"" + kind + "\",\"scope\":\"" + scope + "\"" + extra + "}";
    }

    private static String line(String json) {
        Optional<MaintenanceNotice> n = MaintenanceNotice.parse(json);
        assertTrue(n.isPresent(), "should parse: " + json);
        return n.get().line().orElse("<none>");
    }

    @Test
    void pauseWithWorldScopeCountsDown() {
        assertEquals("Server maintenance in 30 seconds.", line(notice("pause", "world", ",\"seconds\":30")));
    }

    @Test
    void pauseWithWorldScopeAndNoSecondsOmitsTheNumber() {
        assertEquals("Server maintenance soon.", line(notice("pause", "world", "")));
    }

    @Test
    void restartWithWorldScopeCountsDown() {
        assertEquals("Server maintenance in 0 seconds.", line(notice("restart", "world", ",\"seconds\":0")));
        assertEquals("Server maintenance in 600 seconds.", line(notice("restart", "world", ",\"seconds\":600")));
    }

    @Test
    void pauseWithBodiesOrMcpScopeIsTheBriefLine() {
        String brief = "Brief maintenance: some players may drop and return.";
        assertEquals(brief, line(notice("pause", "bodies", "")));
        assertEquals(brief, line(notice("pause", "mcp", ",\"seconds\":10")));
    }

    @Test
    void restartWithBodiesOrMcpScopeSaysNothing() {
        assertEquals("<none>", line(notice("restart", "bodies", "")));
        assertEquals("<none>", line(notice("restart", "mcp", "")));
    }

    @Test
    void backSaysTheMaintenanceIsFinishedForEveryScope() {
        for (String scope : new String[] {"bodies", "world", "mcp"}) {
            assertEquals("Server maintenance finished.", line(notice("back", scope, "")));
        }
    }

    @Test
    void reasonIsOptionalAndMustBeFromTheFixedList() {
        assertEquals("Server maintenance soon.", line(notice("pause", "world", ",\"reason\":\"update\"")));
        assertEquals("Server maintenance soon.", line(notice("pause", "world", ",\"reason\":\"plugin_update\"")));
        assertFalse(MaintenanceNotice.parse(notice("pause", "world", ",\"reason\":\"because\"")).isPresent());
    }

    @Test
    void invalidPayloadsAreIgnored() {
        String[] bad = {
            "not json",
            "[]",
            "{}",
            notice("shutdown", "world", ""),
            notice("pause", "everything", ""),
            "{\"id\":\"deploy-1\",\"kind\":\"pause\"}",
            "{\"id\":\"Deploy 1\",\"kind\":\"pause\",\"scope\":\"world\"}",
            "{\"id\":\"\",\"kind\":\"pause\",\"scope\":\"world\"}",
            "{\"id\":7,\"kind\":\"pause\",\"scope\":\"world\"}",
            "{\"id\":\"deploy-1\",\"kind\":5,\"scope\":\"world\"}",
            notice("pause", "world", ",\"seconds\":601"),
            notice("pause", "world", ",\"seconds\":-1"),
            notice("pause", "world", ",\"seconds\":1.5"),
            notice("pause", "world", ",\"seconds\":\"10\""),
            notice("pause", "world", ",\"text\":\"hello players\""),
        };
        for (String json : bad) {
            assertFalse(MaintenanceNotice.parse(json).isPresent(), "should be ignored: " + json);
        }
    }
}
