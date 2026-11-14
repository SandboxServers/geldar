package dev.geldar.core.skins;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.util.Optional;
import java.util.UUID;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class AgentSkinProviderTest {
    private static final UUID UNKNOWN = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private static final Logger LOG = Logger.getLogger("agent-skin-provider-test");

    private final BufferedImage fallback = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
    private final BufferedImage known = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);

    @Test
    void returnsTheLookupImageWhenThereIsOne() {
        AgentSkinProvider provider = new AgentSkinProvider(uuid -> known, fallback, LOG);

        Optional<BufferedImage> loaded = provider.load(UNKNOWN);

        assertTrue(loaded.isPresent());
        assertSame(known, loaded.get());
    }

    @Test
    void unknownUuidGetsTheFallbackNeverEmpty() {
        // A lookup with no image for this UUID (null) must still give the fallback, not an empty result.
        AgentSkinProvider provider = new AgentSkinProvider(uuid -> null, fallback, LOG);

        Optional<BufferedImage> loaded = provider.load(UNKNOWN);

        assertTrue(loaded.isPresent());
        assertSame(fallback, loaded.get());
    }

    @Test
    void failingLookupGetsTheFallbackNeverEmptyNorThrows() {
        AgentSkinProvider provider = new AgentSkinProvider(uuid -> {
            throw new IllegalStateException("disk gone");
        }, fallback, LOG);

        Optional<BufferedImage> loaded = provider.load(UNKNOWN);

        assertTrue(loaded.isPresent());
        assertSame(fallback, loaded.get());
    }

    @Test
    void virtualMachineErrorIsRethrown() {
        AgentSkinProvider provider = new AgentSkinProvider(uuid -> {
            throw new OutOfMemoryError("test");
        }, fallback, LOG);

        assertThrows(OutOfMemoryError.class, () -> provider.load(UNKNOWN));
    }

    @Test
    void realLookupWithAMissingDirectoryStillGivesAnImage() {
        AgentSkinLookup lookup = new AgentSkinLookup(java.nio.file.Path.of("no-such-dir-gx07"), fallback, LOG);
        AgentSkinProvider provider = new AgentSkinProvider(lookup::lookup, fallback, LOG);

        assertEquals(fallback, provider.load(UNKNOWN).orElseThrow());
    }
}
