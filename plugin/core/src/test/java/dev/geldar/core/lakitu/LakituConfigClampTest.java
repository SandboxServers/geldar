package dev.geldar.core.lakitu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class LakituConfigClampTest {
    @Test
    void defaultsAreOffWithTheProposedCaps() {
        List<String> warnings = new ArrayList<>();
        LakituConfig c = LakituConfig.load(new YamlConfiguration(), warnings::add);
        assertFalse(c.enabled());
        assertEquals(4, c.radiusChunks());
        assertEquals(256, c.maxSectionsPerFrame());
        assertEquals(512, c.maxUpdatesPerFrame());
        assertEquals(4, c.maxPanesPerSession());
        assertEquals(5, c.frameHz());
        assertTrue(warnings.isEmpty());
    }

    @Test
    void radiusNineIsClampedToFourAndLoggedOnce() {
        YamlConfiguration file = new YamlConfiguration();
        file.set("lakitu.radius_chunks", 9);
        List<String> warnings = new ArrayList<>();
        assertEquals(4, LakituConfig.load(file, warnings::add).radiusChunks());
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("lakitu.radius_chunks"));
    }

    @Test
    void everyCapIsClampedAndLowValuesStay() {
        YamlConfiguration file = new YamlConfiguration();
        file.set("lakitu.enabled", true);
        file.set("lakitu.max_sections_per_frame", 9999);
        file.set("lakitu.max_updates_per_frame", 9999);
        file.set("lakitu.max_panes_per_session", 3);
        file.set("lakitu.frame_hz", 60);
        List<String> warnings = new ArrayList<>();
        LakituConfig c = LakituConfig.load(file, warnings::add);
        assertTrue(c.enabled());
        assertEquals(256, c.maxSectionsPerFrame());
        assertEquals(512, c.maxUpdatesPerFrame());
        assertEquals(3, c.maxPanesPerSession());
        assertEquals(10, c.frameHz());
        assertEquals(3, warnings.size());
    }

    @Test
    void zeroAndNegativeValuesAreRaisedToOne() {
        YamlConfiguration file = new YamlConfiguration();
        file.set("lakitu.frame_hz", 0);
        file.set("lakitu.radius_chunks", -2);
        assertEquals(1, LakituConfig.load(file, s -> {}).frameHz());
        assertEquals(1, LakituConfig.load(file, s -> {}).radiusChunks());
    }
}
