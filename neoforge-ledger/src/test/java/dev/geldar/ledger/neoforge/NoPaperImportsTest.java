package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Mirror of ledger-core's NoLoaderImportsTest for the other side: this module must not name Paper or Velocity. */
class NoPaperImportsTest {
    private static final Pattern FORBIDDEN = Pattern.compile(
            "(?<![\\w.])(?:org\\.bukkit|io\\.papermc|com\\.destroystokyo|com\\.velocitypowered|net\\.kyori)\\.");

    private static List<String> violations(Path root) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String[] lines = Files.readString(file).split("\n", -1);
                for (int i = 0; i < lines.length; i++) {
                    String line = lines[i].strip();
                    if (!line.startsWith("//") && !line.startsWith("*") && FORBIDDEN.matcher(line).find()) {
                        found.add(root.relativize(file) + ":" + (i + 1) + ": " + line);
                    }
                }
            }
        }
        return found;
    }

    @Test
    void mainSourcesHaveNoPaperOrVelocityImports() throws IOException {
        Path src = Path.of("src", "main", "java");
        assertTrue(Files.isDirectory(src), "source tree not found: " + src.toAbsolutePath());
        assertEquals(List.of(), violations(src));
    }

    @Test
    void scannerFlagsEachForbiddenPrefix(@TempDir Path dir) throws IOException {
        Files.writeString(dir.resolve("Bad.java"), "package x;\nimport org.bukkit.A;\nimport io.papermc.A;\n"
                + "import com.destroystokyo.A;\nimport com.velocitypowered.A;\nimport net.kyori.A;\nimport net.neoforged.A;\n");
        assertEquals(5, violations(dir).size());
    }
}