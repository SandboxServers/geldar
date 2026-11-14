package dev.geldar.core.skins;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AgentSkinLookupTest {
    private static final UUID JASON = UUID.fromString("a380937d-20dd-39b8-83ae-4219fa1c156d");
    private static final Logger LOG = Logger.getLogger("agent-skin-test");
    private static final int RED = 0xffff0000;

    @TempDir
    Path dir;

    private final BufferedImage defaultImage = AgentSkinLookup.defaultSkin();

    @Test
    void offlineUuidMatchesTheSkinHeadsVector() {
        assertEquals(JASON, AgentSkinLookup.offlineUuid("ag_jason_01"));
    }

    @Test
    void defaultSkinIs64x64AndNeverEmpty() {
        BufferedImage image = AgentSkinLookup.defaultSkin();

        assertNotNull(image);
        assertEquals(64, image.getWidth());
        assertEquals(64, image.getHeight());
        for (int x = 0; x < 64; x++) {
            for (int y = 0; y < 64; y++) {
                boolean hat = x >= 40 && x < 48 && y >= 8 && y < 16;
                if (!hat) {
                    assertEquals(0xff, image.getRGB(x, y) >>> 24, "opaque at " + x + "," + y);
                }
            }
        }
    }

    @Test
    void defaultSkinFaceIsOnTheHeadAreaAndHasTwoColours() {
        BufferedImage image = AgentSkinLookup.defaultSkin();
        Set<Integer> colours = new HashSet<>();
        for (int x = 8; x < 16; x++) {
            for (int y = 8; y < 16; y++) {
                colours.add(image.getRGB(x, y));
            }
        }

        assertEquals(2, colours.size());
        assertEquals(0x00, image.getRGB(44, 12) >>> 24);
    }

    @Test
    void defaultSkinIsDeterministicAcrossCalls() {
        int[] first = pixels(AgentSkinLookup.defaultSkin());
        int[] second = pixels(AgentSkinLookup.defaultSkin());

        assertTrue(Arrays.equals(first, second));
    }

    private static int[] pixels(BufferedImage image) {
        return image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
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

    @Test
    void mixedCaseStemReturnsTheDefaultEvenWhenTheUuidMatches() throws IOException {
        Files.write(dir.resolve("Ag_Jason_01.png"), png(solid(64, 64, RED)));

        assertSame(defaultImage, lookup(AgentSkinLookup.offlineUuid("Ag_Jason_01")));
    }

    @Test
    void thirtyThreeCharacterStemReturnsTheDefaultEvenWhenTheUuidMatches() throws IOException {
        String stem = "a".repeat(33);
        Files.write(dir.resolve(stem + ".png"), png(solid(64, 64, RED)));

        assertSame(defaultImage, lookup(AgentSkinLookup.offlineUuid(stem)));
    }

    @Test
    void thirtyTwoCharacterStemIsRead() throws IOException {
        String stem = "a".repeat(32);
        Files.write(dir.resolve(stem + ".png"), png(solid(64, 64, RED)));

        assertEquals(RED, lookup(AgentSkinLookup.offlineUuid(stem)).getRGB(0, 0));
    }

    @Test
    void symlinkInTheDirectoryIsFollowed() throws IOException {
        Path target = Files.write(dir.resolve("target.bin"), png(solid(64, 64, RED)));
        Path link = dir.resolve("ag_jason_01.png");
        try {
            Files.createSymbolicLink(link, target);
        } catch (IOException | UnsupportedOperationException e) {
            Assumptions.assumeTrue(false, "this filesystem cannot create symlinks: " + e.getClass().getSimpleName());
        }

        assertEquals(RED, lookup(JASON).getRGB(0, 0));
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
