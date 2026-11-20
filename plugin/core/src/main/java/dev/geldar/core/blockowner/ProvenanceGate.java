package dev.geldar.core.blockowner;

import org.bukkit.configuration.file.FileConfiguration;

/**
 * The provenance switch the listeners read: on only when {@code blockowner.enabled} and {@code provenance.enabled} are
 * both true. Off until the first {@link #reload}, so nothing is recorded before the config has been read.
 */
final class ProvenanceGate {
    private volatile boolean enabled = true;
    private volatile boolean provenance;

    /** Reads both keys; {@code provenance.enabled} is false when absent. */
    void reload(FileConfiguration config) {
        provenance = BlockOwnerSetup.provenanceEnabled(config);
        enabled = config.getBoolean("blockowner.enabled", true);
    }

    /** True when the provenance messages of breaks and pickups should be sent. */
    boolean on() {
        return enabled && provenance;
    }
}
