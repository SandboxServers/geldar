package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The core must stay loader-neutral: no loader or game import anywhere under its source tree. */
class NoLoaderImportsTest {
    private static final Pattern FORBIDDEN = Pattern.compile(
            "^import\\s+(org\\.bukkit|io\\.papermc|com\\.destroystokyo|net\\.minecraft|net\\.fabricmc|net\\.neoforged|com\\.velocitypowered|net\\.kyori)");

    static List<String> violations(Path root) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                List<String> lines = Files.readAllLines(file);
                for (int i = 0; i < lines.size(); i++) {
                    if (FORBIDDEN.matcher(lines.get(i)).find()) {
                        found.add(root.relativize(file) + ":" + (i + 1) + ": " + lines.get(i));
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
}