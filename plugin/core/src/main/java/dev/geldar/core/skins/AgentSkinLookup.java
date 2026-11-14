package dev.geldar.core.skins;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.UUID;
import java.util.logging.Logger;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageInputStream;

/**
 * An agent's skin, read from {@code <dir>/<life_id>.png} (the files the {@code skin heads} verb reads). The
 * directory is read again on every call, so no state is shared between threads. {@link #lookup} never returns
 * null and never throws: a missing directory, a corrupt, oversized or wrong-sized file, or any other failure
 * yields the default image. The log names only the UUID, never a file name.
 */
public final class AgentSkinLookup {
    /** The largest skin file read, as in the players-cli skin reader. */
    static final long MAX_SKIN_BYTES = 64L * 1024L;

    private static final Pattern STEM = Pattern.compile("^[a-z][a-z0-9_-]{0,31}$");
    private static final String PNG_SUFFIX = ".png";
    private static final int BODY_ARGB = 0xff6b7785;
    private static final int FACE_ARGB = 0xffd2b48c;
    private static final int EYE_ARGB = 0xff3b2f2f;

    private final Path dir;
    private final BufferedImage defaultImage;
    private final Logger log;

    public AgentSkinLookup(Path dir, BufferedImage defaultImage, Logger log) {
        this.dir = dir;
        this.defaultImage = defaultImage;
        this.log = log;
    }

    /** The Java offline UUID of a login name, as BlueMap and the skin heads verb key it. */
    public static UUID offlineUuid(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * The default skin, built in code: the repo's leak scan forbids tracked skin PNGs, so nothing is loaded from a
     * resource. A 64x64 layout: the body colour everywhere, the face on the head area (8,8)-(16,16) in a skin tone
     * with two dark eyes, and the hat layer (40,8)-(48,16) transparent so it does not cover the face. Every call
     * returns a new image with the same pixels.
     */
    public static BufferedImage defaultSkin() {
        BufferedImage image = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        for (int x = 0; x < 64; x++) {
            for (int y = 0; y < 64; y++) {
                image.setRGB(x, y, BODY_ARGB);
            }
        }
        for (int x = 8; x < 16; x++) {
            for (int y = 8; y < 16; y++) {
                image.setRGB(x, y, FACE_ARGB);
            }
        }
        image.setRGB(10, 11, EYE_ARGB);
        image.setRGB(13, 11, EYE_ARGB);
        for (int x = 40; x < 48; x++) {
            for (int y = 8; y < 16; y++) {
                image.setRGB(x, y, 0x00000000);
            }
        }
        return image;
    }

    /** The agent's skin, or the default image when there is none or it cannot be read. */
    public BufferedImage lookup(UUID uuid) {
        try {
            Path file = findFile(uuid);
            if (file == null) {
                return defaultImage;
            }
            BufferedImage image = readSkin(file);
            return image == null ? defaultImage : image;
        } catch (Exception e) {
            log.warning("skin lookup failed for " + uuid + ": " + e.getClass().getSimpleName());
            return defaultImage;
        }
    }

    private Path findFile(UUID uuid) throws IOException {
        try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*" + PNG_SUFFIX)) {
            for (Path file : files) {
                String name = file.getFileName().toString();
                String stem = name.substring(0, name.length() - PNG_SUFFIX.length());
                if (STEM.matcher(stem).matches() && offlineUuid(stem).equals(uuid)) {
                    // Only the stems the agent ids allow (lower case, at most 32 characters) are read.
                    return file;
                }
            }
        }
        return null;
    }

    /** The decoded skin, or null when the file is oversized, not a PNG, or not 64x64 or 64x32. */
    private static BufferedImage readSkin(Path file) throws IOException {
        if (Files.size(file) > MAX_SKIN_BYTES) {
            return null;
        }
        byte[] bytes = Files.readAllBytes(file);
        if (bytes.length > MAX_SKIN_BYTES) {
            return null;
        }
        try (ImageInputStream in = new MemoryCacheImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in);
                if (!"png".equalsIgnoreCase(reader.getFormatName())) {
                    return null;
                }
                // The size is checked before the pixels are decoded, so a header claiming a huge image is refused.
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width != 64 || (height != 64 && height != 32)) {
                    return null;
                }
                return reader.read(0);
            } finally {
                reader.dispose();
            }
        }
    }
}
