package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** Safety rule S9: plugin.yml declares no commands and no permissions. */
class PluginYmlTest {
    private static String pluginYml() throws IOException {
        try (InputStream in = PluginYmlTest.class.getClassLoader().getResourceAsStream("plugin.yml")) {
            assertNotNull(in, "plugin.yml missing");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static boolean hasKey(String yml, String key) {
        return Pattern.compile("^\\s*" + key + "\\s*:", Pattern.MULTILINE).matcher(yml).find();
    }

    @Test
    void declaresNoCommandsAndNoPermissions() throws IOException {
        String yml = pluginYml();
        assertFalse(hasKey(yml, "commands"));
        assertFalse(hasKey(yml, "permissions"));
    }

    @Test
    void keyDetectorSeesBothKeys() {
        assertTrue(hasKey("name: X\ncommands:\n  a: {}\n", "commands"));
        assertTrue(hasKey("name: X\npermissions:\n  a: {}\n", "permissions"));
    }

    @Test
    void declaresTheExpectedHeader() throws IOException {
        String yml = pluginYml();
        assertTrue(yml.contains("name: Ledger"));
        assertTrue(yml.contains("main: dev.geldar.ledger.paper.LedgerPlugin"));
        assertTrue(yml.contains("softdepend: [spark, Chunky, BlueMap, CoreProtect]"));
    }
}