package dev.geldar.core.skins;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.UUID;
import java.util.logging.Logger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AgentSkinLookupTest {
    private static final UUID JASON = UUID.fromString("a380937d-20dd-39b8-83ae-4219fa1c156d");
    private static final Logger LOG = Logger.getLogger("agent-skin-test");
    private static final int RED = 0xffff0000;

    @TempDir
    Path dir;

    private final BufferedImage defaultImage = solid(64, 64, 0xff00ff00);

    @Test
    void offlineUuidMatchesTheSkinHeadsVector() {
        assertEquals(JASON, AgentSkinLookup.offlineUuid("ag_jason_01"));
    }

    @Test
    void knownUuidReturnsItsPng() throws IOException {
        Files.write(dir.resolve("ag_jason_01.png"), png(solid(64, 64, RED)));

        BufferedImage image = lookup(JASON);

        assertEquals(64, image.getWidth());
        assertEquals(64, image.getHeight());
        assertEquals(RED, image.getRGB(0, 0));
    }

    @Test
    void legacy64x32SkinIsAccepted() throws IOException {
        Files.write(dir.resolve("ag_jason_01.png"), png(solid(64, 32, RED)));

        BufferedImage image = lookup(JASON);

        assertEquals(64, image.getWidth());
        assertEquals(32, image.getHeight());
    }

    @Test
    void unknownUuidReturnsTheDefault() throws IOException {
        Files.write(dir.resolve("ag_jason_01.png"), png(solid(64, 64, RED)));

        BufferedImage image = lookup(AgentSkinLookup.offlineUuid("ag_nobody_01"));

        assertSame(defaultImage, image);
    }

    @Test
    void corruptFileReturnsTheDefault() throws IOException {
        byte[] valid = png(solid(64, 64, RED));
        Files.write(dir.resolve("ag_jason_01.png"), Arrays.copyOf(valid, valid.length / 2));

        assertSame(defaultImage, lookup(JASON));
    }

    @Test
    void missingDirectoryReturnsTheDefault() {
        AgentSkinLookup lookup = new AgentSkinLookup(dir.resolve("absent"), defaultImage, LOG);

        assertSame(defaultImage, lookup.lookup(JASON));
    }

    @Test
    void oversizedFileReturnsTheDefault() throws IOException {
        byte[] valid = png(solid(64, 64, RED));
        byte[] padded = Arrays.copyOf(valid, valid.length + (int) AgentSkinLookup.MAX_SKIN_BYTES);
        Files.write(dir.resolve("ag_jason_01.png"), padded);

        assertSame(defaultImage, lookup(JASON));
    }

    @Test
    void wrongSizeReturnsTheDefault() throws IOException {
        Files.write(dir.resolve("ag_jason_01.png"), png(solid(32, 32, RED)));

        assertSame(defaultImage, lookup(JASON));
    }

    @Test
    void unreadableFileReturnsTheDefaultWithoutThrowing() throws IOException {
        // A directory named like a skin: it matches the scan, but reading it fails.
        Files.createDirectories(dir.resolve("ag_jason_01.png"));

        assertSame(defaultImage, lookup(JASON));
    }

    private BufferedImage lookup(UUID uuid) {
        BufferedImage image = new AgentSkinLookup(dir, defaultImage, LOG).lookup(uuid);
        assertNotNull(image);
        return image;
    }

    private static BufferedImage solid(int width, int height, int argb) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < width; x++) {
            for (int y = 0; y < height; y++) {
                image.setRGB(x, y, argb);
            }
        }
        return image;
    }

    static byte[] png(BufferedImage image) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }
}
