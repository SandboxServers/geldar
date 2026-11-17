package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ModInfoTest {
    @Test
    void modIdIsTheExpectedId() {
        assertEquals("geldar_neoforge", ModInfo.modId());
    }

    @Test
    void modIdMatchesTheModsTomlModId() throws IOException {
        String toml = readModsToml();
        int modsTable = toml.indexOf("[[mods]]");
        assertTrue(modsTable >= 0, "neoforge.mods.toml has no [[mods]] table");
        // The first modId after [[mods]] is the mod's own; dependency tables come later in the file.
        Matcher matcher = Pattern.compile("(?m)^modId\\s*=\\s*\"([^\"]+)\"").matcher(toml.substring(modsTable));
        assertTrue(matcher.find(), "no modId in the [[mods]] table");
        assertEquals(ModInfo.modId(), matcher.group(1));
    }

    private static String readModsToml() throws IOException {
        try (InputStream in = ModInfoTest.class.getClassLoader().getResourceAsStream("META-INF/neoforge.mods.toml")) {
            assertNotNull(in, "META-INF/neoforge.mods.toml is not on the classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
