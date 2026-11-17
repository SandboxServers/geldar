package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Copy of plugin/ledger-core's NoLoaderImportsTest (same scanner and self-tests), run here over the ledger-core tree so a
 * change there that imports a loader type also fails this build. Keep the two in step; the upstream one is not edited.
 */
class NoLoaderImportsTest {
    /** The forbidden package prefixes as tokens: an import, a static import or a fully qualified name in code. */
    private static final Pattern FORBIDDEN = Pattern.compile(
            "(?<![\\w.])(?:org\\.bukkit|io\\.papermc|com\\.destroystokyo|net\\.minecraft|net\\.fabricmc|net\\.neoforged|com\\.velocitypowered|net\\.kyori)\\.");

    /** Comments, string literals and text blocks: a mention there is not a dependency. */
    private static final Pattern NON_CODE = Pattern.compile(
            "\"\"\".*?\"\"\"|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|//[^\\n]*|/\\*.*?\\*/", Pattern.DOTALL);

    /** Blanks out non-code but keeps every newline, so line numbers stay right. */
    static String codeOnly(String source) {
        Matcher m = NON_CODE.matcher(source);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            m.appendReplacement(out, Matcher.quoteReplacement(m.group().replaceAll("[^\\n]", " ")));
        }
        m.appendTail(out);
        return out.toString();
    }

    static List<String> violations(Path root) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String[] lines = codeOnly(Files.readString(file)).split("\n", -1);
                for (int i = 0; i < lines.length; i++) {
                    if (FORBIDDEN.matcher(lines[i]).find()) {
                        found.add(root.relativize(file) + ":" + (i + 1) + ": " + lines[i].strip());
                    }
                }
            }
        }
        return found;
    }
    @Test
    void coreSourceTreeHasNoLoaderImports() throws IOException {
        Path src = Paths.get(System.getProperty("ledger.core.src"));
        assertTrue(Files.isDirectory(src), "source tree not found: " + src);
        assertEquals(List.of(), violations(src));
    }

    @Test
    void scannerFlagsALoaderImport(@TempDir Path dir) throws IOException {
        Files.writeString(dir.resolve("Bad.java"), "package x;\nimport org.bukkit.Bukkit;\nclass Bad {}\n");
        assertEquals(1, violations(dir).size());
    }

    @Test
    void scannerFlagsEveryForbiddenPrefixAndAllowsOthers(@TempDir Path dir) throws IOException {
        String[] bad = {"org.bukkit.A", "io.papermc.A", "com.destroystokyo.A", "net.minecraft.A", "net.fabricmc.A",
            "net.neoforged.A", "com.velocitypowered.A", "net.kyori.A"};
        StringBuilder text = new StringBuilder("package x;\n");
        for (String name : bad) {
            text.append("import ").append(name).append(";\n");
        }
        text.append("import io.opentelemetry.api.OpenTelemetry;\nimport java.util.List;\n");
        Files.writeString(dir.resolve("All.java"), text.toString());
        List<String> found = violations(dir);
        assertEquals(bad.length, found.size());
        assertFalse(found.stream().anyMatch(s -> s.contains("opentelemetry")));
    }

    private static int count(Path dir, String source) throws IOException {
        Path file = dir.resolve("T.java");
        Files.writeString(file, source);
        int n = violations(dir).size();
        Files.delete(file);
        return n;
    }

    @Test
    void scannerFlagsStaticIndentedAndQualifiedForms(@TempDir Path dir) throws IOException {
        assertEquals(1, count(dir, "import static org.bukkit.Material.STONE;\nclass T {}\n"));
        assertEquals(1, count(dir, "    import org.bukkit.Bukkit;\nclass T {}\n"));
        assertEquals(1, count(dir, "\timport net.kyori.adventure.text.Component;\n"));
        assertEquals(1, count(dir, "class T { void f() { org.bukkit.Bukkit.getServer(); } }\n"));
        assertEquals(1, count(dir, "class T { io.papermc.paper.A a; }\n"));
        assertEquals(2, count(dir, "class T {\n org.bukkit.Server s;\n com.velocitypowered.api.A b;\n}\n"));
    }

    @Test
    void scannerIgnoresCommentsStringsAndLookalikes(@TempDir Path dir) throws IOException {
        assertEquals(0, count(dir, "// org.bukkit.Bukkit\nclass T {}\n"));
        assertEquals(0, count(dir, "/** uses org.bukkit.Bukkit\n and net.kyori.A */\nclass T {}\n"));
        assertEquals(0, count(dir, "class T { String s = \"org.bukkit.Bukkit\"; }\n"));
        assertEquals(0, count(dir, "class T { String s = \"\"\"\n org.bukkit.A\n \"\"\"; }\n"));
        assertEquals(0, count(dir, "import com.example.org.bukkit.A;\nimport io.opentelemetry.api.A;\nimport org.bukkitx.A;\n"));
        // line numbers survive a block comment
        Files.writeString(dir.resolve("L.java"), "/* a\n b */\nimport org.bukkit.A;\n");
        assertTrue(violations(dir).get(0).startsWith("L.java:3:"));
    }
}