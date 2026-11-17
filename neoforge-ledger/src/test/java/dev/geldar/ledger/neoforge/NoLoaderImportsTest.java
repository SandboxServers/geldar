package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/**
 * Re-runs the ledger-core loader-neutrality scan from this build, so a ledger-core change that imports a loader
 * type fails here too. The patterns mirror plugin/ledger-core's NoLoaderImportsTest, which is not edited.
 */
class NoLoaderImportsTest {
    private static final Pattern FORBIDDEN = Pattern.compile(
            "(?<![\\w.])(?:org\\.bukkit|io\\.papermc|com\\.destroystokyo|net\\.minecraft|net\\.fabricmc|net\\.neoforged|com\\.velocitypowered|net\\.kyori)\\.");

    @Test
    void ledgerCoreSourceTreeHasNoLoaderImports() throws IOException {
        Path src = Paths.get(System.getProperty("ledger.core.src"));
        assertTrue(Files.isDirectory(src), "ledger-core source tree not found: " + src);
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(src.resolve("main"))) {
            for (Path file : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                for (String line : Files.readAllLines(file)) {
                    String s = line.strip();
                    if (s.startsWith("import ") && FORBIDDEN.matcher(s.substring(7)).find()) {
                        found.add(src.relativize(file) + ": " + s);
                    }
                }
            }
        }
        assertEquals(List.of(), found);
    }
}