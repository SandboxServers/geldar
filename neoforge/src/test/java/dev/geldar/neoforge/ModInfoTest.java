package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ModInfoTest {
    /** The javafml loader version: fancymodloader loader-11.0.15, manifest Implementation-Version 11.0. */
    private static final String FML_LOADER_VERSION = "11.0";
    /** The NeoForge and Minecraft pins (NeoForge 26.1.2 build 126, Minecraft 26.1.2). */
    private static final String PINNED_VERSION = "26.1.2";
    private static final String DEPENDENCY_TABLE = "[[dependencies.geldar_neoforge]]";
    private static final Pattern KEY_VALUE = Pattern.compile("^(\\w+)\\s*=\\s*\"([^\"]*)\"$");
    private static final Pattern RANGE = Pattern.compile("^\\[([0-9.]+),([0-9.]*)\\)$");

    @Test
    void modIdIsTheExpectedId() {
        assertEquals("geldar_neoforge", ModInfo.modId());
    }

    @Test
    void modsTomlDeclaresTheModId() throws IOException {
        Map<String, String> mods = table(tables(readModsToml()), "[[mods]]", null);
        assertEquals(ModInfo.modId(), mods.get("modId"));
    }

    @Test
    void modsTomlUsesTheJavafmlLoader() throws IOException {
        assertEquals("javafml", tables(readModsToml()).get(0).get("modLoader"));
    }

    @Test
    void loaderVersionRangeAcceptsTheFmlLoaderVersion() throws IOException {
        String range = tables(readModsToml()).get(0).get("loaderVersion");
        assertNotNull(range, "neoforge.mods.toml has no top-level loaderVersion");
        assertTrue(rangeContains(range, FML_LOADER_VERSION),
                "loaderVersion " + range + " does not accept the FML loader " + FML_LOADER_VERSION);
    }

    @Test
    void neoforgeAndMinecraftDependenciesAreServerSideAndAcceptThePin() throws IOException {
        List<Map<String, String>> tables = tables(readModsToml());
        for (String dependency : List.of("neoforge", "minecraft")) {
            Map<String, String> entry = table(tables, DEPENDENCY_TABLE, dependency);
            assertEquals("required", entry.get("type"), dependency + " is not a required dependency");
            assertEquals("SERVER", entry.get("side"), dependency + " is not declared server-side");
            String range = entry.get("versionRange");
            assertNotNull(range, dependency + " has no versionRange");
            assertTrue(rangeContains(range, PINNED_VERSION), dependency + " " + range + " rejects " + PINNED_VERSION);
        }
    }

    @Test
    void versionRangeHelperFollowsMavenHalfOpenRules() {
        assertTrue(rangeContains("[11,)", "11.0"));
        assertTrue(rangeContains("[11,)", "12"));
        assertFalse(rangeContains("[11,)", "10.9"));
        assertTrue(rangeContains("[26.1,26.2)", "26.1"));
        assertTrue(rangeContains("[26.1,26.2)", "26.1.2"));
        assertFalse(rangeContains("[26.1,26.2)", "26.0.9"));
        assertFalse(rangeContains("[26.1,26.2)", "26.2"));
        assertFalse(rangeContains("[26.1,26.2)", "11.0"));
    }

    @Test
    void versionRangeHelperRejectsUnsupportedForms() {
        assertThrows(IllegalArgumentException.class, () -> rangeContains("(11,)", "11.0"));
        assertThrows(IllegalArgumentException.class, () -> rangeContains("[11]", "11.0"));
    }

    private static boolean rangeContains(String range, String version) {
        Matcher m = RANGE.matcher(range);
        if (!m.matches()) {
            throw new IllegalArgumentException("unsupported version range " + range);
        }
        boolean aboveLower = compareVersions(version, m.group(1)) >= 0;
        boolean belowUpper = m.group(2).isEmpty() || compareVersions(version, m.group(2)) < 0;
        return aboveLower && belowUpper;
    }

    private static int compareVersions(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? Integer.parseInt(x[i]) : 0;
            int q = i < y.length ? Integer.parseInt(y[i]) : 0;
            if (p != q) {
                return Integer.compare(p, q);
            }
        }
        return 0;
    }

    /** Splits the toml into tables: index 0 is the top-level keys, then one map per [header] line. */
    private static List<Map<String, String>> tables(String toml) {
        List<Map<String, String>> tables = new ArrayList<>();
        Map<String, String> current = new HashMap<>();
        tables.add(current);
        for (String line : toml.split("\n")) {
            String trimmed = line.strip();
            if (trimmed.startsWith("[")) {
                current = new HashMap<>();
                current.put("#header", trimmed);
                tables.add(current);
                continue;
            }
            Matcher m = KEY_VALUE.matcher(trimmed);
            if (m.matches()) {
                current.put(m.group(1), m.group(2));
            }
        }
        return tables;
    }

    /** The first table with this header, and with this modId when modId is not null. */
    private static Map<String, String> table(List<Map<String, String>> tables, String header, String modId) {
        for (Map<String, String> table : tables) {
            if (header.equals(table.get("#header")) && (modId == null || modId.equals(table.get("modId")))) {
                return table;
            }
        }
        throw new AssertionError("neoforge.mods.toml has no " + header + " table" + (modId == null ? "" : " for " + modId));
    }

    private static String readModsToml() throws IOException {
        try (InputStream in = ModInfoTest.class.getClassLoader().getResourceAsStream("META-INF/neoforge.mods.toml")) {
            assertNotNull(in, "META-INF/neoforge.mods.toml is not on the classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
