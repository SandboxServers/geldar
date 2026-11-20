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

    @Test
    @DisplayName("the gate is off before any reload")
    void gateOffBeforeReload() {
        assertFalse(new ProvenanceGate().on());
    }

    @Test
    @DisplayName("the gate is on after a reload with provenance.enabled true")
    void gateOnAfterReloadWithFlag() {
        ProvenanceGate gate = new ProvenanceGate();
        YamlConfiguration config = new YamlConfiguration();
        config.set("provenance.enabled", true);
        gate.reload(config);
        assertTrue(gate.on());
    }

    @Test
    @DisplayName("the gate goes off when a reload finds the key removed")
    void gateOffAfterKeyRemoved() {
        ProvenanceGate gate = new ProvenanceGate();
        YamlConfiguration config = new YamlConfiguration();
        config.set("provenance.enabled", true);
        gate.reload(config);
        gate.reload(new YamlConfiguration());
        assertFalse(gate.on());
    }

    @Test
    @DisplayName("blockowner.enabled false keeps the gate off even with provenance.enabled true")
    void gateOffWhenBlockOwnerDisabled() {
        ProvenanceGate gate = new ProvenanceGate();
        YamlConfiguration config = new YamlConfiguration();
        config.set("blockowner.enabled", false);
        config.set("provenance.enabled", true);
        gate.reload(config);
        assertFalse(gate.on());
    }
}
