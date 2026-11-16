package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Safety rule S9: plugin.yml has only the allow-listed top-level keys. In particular no {@code libraries} (Paper would
 * download unpinned jars at runtime), no {@code commands}, no {@code permissions}, no {@code default-permission}, no
 * {@code provides}, no {@code load}, no {@code depend}.
 */
class PluginYmlTest {
    static final Set<String> ALLOWED = Set.of("name", "main", "version", "api-version", "description", "softdepend");

    private static final Pattern KEY = Pattern.compile("^(?:\"([^\"]*)\"|'([^']*)'|([^\\s:#\"'{\\[?\\-][^:]*?))\\s*:(?:\\s|$)");

    private static String pluginYml() throws IOException {
        try (InputStream in = PluginYmlTest.class.getClassLoader().getResourceAsStream("plugin.yml")) {
            assertNotNull(in, "plugin.yml missing");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** Top-level keys (column 0), quotes removed. A column-0 line that is not a plain key is reported as "?line". */
    static List<String> topLevelKeys(String yml) {
        List<String> keys = new ArrayList<>();
        for (String line : yml.split("\r?\n", -1)) {
            if (line.isBlank() || line.startsWith("#") || line.equals("---") || line.equals("...")) {
                continue;
            }
            if (Character.isWhitespace(line.charAt(0))) {
                continue; // continuation or nested content
            }
            Matcher m = KEY.matcher(line);
            if (m.find()) {
                keys.add(m.group(1) != null ? m.group(1) : m.group(2) != null ? m.group(2) : m.group(3).trim());
            } else {
                keys.add("?" + line);
            }
        }
        return keys;
    }

    static List<String> disallowed(String yml) {
        return topLevelKeys(yml).stream().filter(k -> !ALLOWED.contains(k)).toList();
    }

    @Test
    void realPluginYmlHasOnlyAllowListedKeys() throws IOException {
        String yml = pluginYml();
        assertEquals(List.of(), disallowed(yml));
        assertEquals(ALLOWED, Set.copyOf(topLevelKeys(yml)));
    }

    @Test
    void everyForbiddenKeyIsRejected() {
        for (String key : List.of("libraries", "commands", "permissions", "default-permission", "provides", "load",
                "depend", "loadbefore", "authors", "website")) {
            assertEquals(List.of(key), disallowed("name: X\n" + key + ":\n  a: b\n"), key);
        }
    }

    @Test
    void quotedAndFlowAndInlineFormsAreRejected() {
        assertEquals(List.of("commands"), disallowed("name: X\n\"commands\": {}\n"));
        assertEquals(List.of("libraries"), disallowed("name: X\n'libraries': [a:b:1]\n"));
        assertEquals(List.of("permissions"), disallowed("name: X\npermissions: {}\n"));
        assertEquals(List.of("commands"), disallowed("name: X\ncommands :\n  a: {}\n"));
        assertTrue(disallowed("{name: X, commands: {}}\n").get(0).startsWith("?"));
        assertTrue(disallowed("name: X\n? commands\n: {}\n").get(0).startsWith("?"));
    }

    @Test
    void nestedKeysAndCommentsAreNotTopLevel() {
        assertEquals(List.of(), disallowed("name: X\n# commands: no\ndescription: >\n  libraries: not a key\nsoftdepend:\n  - spark\n"));
    }

    @Test
    void declaresTheExpectedHeader() throws IOException {
        String yml = pluginYml();
        assertTrue(yml.contains("name: Ledger"));
        assertTrue(yml.contains("main: dev.geldar.ledger.paper.LedgerPlugin"));
        assertTrue(yml.contains("softdepend: [spark, Chunky, BlueMap, CoreProtect]"));
    }
}
