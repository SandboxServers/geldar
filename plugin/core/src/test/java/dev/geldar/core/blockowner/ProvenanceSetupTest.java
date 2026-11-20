package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The provenance flag read from config.yml: off by default, on only when provenance.enabled is true. */
class ProvenanceSetupTest {

    @Test
    @DisplayName("provenance is off when the key is absent")
    void offWhenKeyAbsent() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("blockowner.enabled", true);
        assertFalse(BlockOwnerSetup.provenanceEnabled(config));
    }

    @Test
    @DisplayName("provenance is off when provenance.enabled is false")
    void offWhenFalse() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("provenance.enabled", false);
        assertFalse(BlockOwnerSetup.provenanceEnabled(config));
    }

    @Test
    @DisplayName("provenance is on when provenance.enabled is true")
    void onWhenTrue() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("provenance.enabled", true);
        assertTrue(BlockOwnerSetup.provenanceEnabled(config));
    }
}
