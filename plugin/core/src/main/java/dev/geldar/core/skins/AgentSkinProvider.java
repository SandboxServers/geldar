package dev.geldar.core.skins;

import de.bluecolored.bluemap.api.plugin.SkinProvider;
import java.awt.image.BufferedImage;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.logging.Logger;

/**
 * The BlueMap skin provider for agents. BlueMap deletes a player's head file when the provider returns an empty
 * result, so this never returns empty and never throws: when the lookup yields nothing or fails, it returns the
 * fallback image. Only a VirtualMachineError (such as OutOfMemoryError) is rethrown. Calls come from BlueMap's pool.
 */
public final class AgentSkinProvider implements SkinProvider {
    private final Function<UUID, BufferedImage> lookup;
    private final BufferedImage fallback;
    private final Logger log;

    public AgentSkinProvider(Function<UUID, BufferedImage> lookup, BufferedImage fallback, Logger log) {
        this.lookup = Objects.requireNonNull(lookup, "lookup");
        this.fallback = Objects.requireNonNull(fallback, "fallback");
        this.log = Objects.requireNonNull(log, "log");
    }

    @Override
    public Optional<BufferedImage> load(UUID uuid) {
        BufferedImage image;
        try {
            image = lookup.apply(uuid);
        } catch (VirtualMachineError e) {
            throw e;
        } catch (Throwable t) {
            log.warning("skin provider lookup threw for " + uuid + ": " + t.getClass().getSimpleName());
            image = null;
        }
        return Optional.of(image != null ? image : fallback);
    }
}
