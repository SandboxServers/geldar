package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Keeps the mod server-only and vanilla-client compatible: no registry entries (which the client must
 * sync) and no network payloads. Scans the main sources for the registry and payload APIs by name.
 */
class NoRegistryScanTest {
    private static final List<String> FORBIDDEN = List.of(
            "DeferredRegister", "RegisterEvent", "registerPayload", "PayloadRegistrar");

    @Test
    void mainSourcesIntroduceNoRegistriesOrPayloads() throws IOException {
        Path root = Path.of("src", "main", "java");
        assertTrue(Files.isDirectory(root), "scan root missing: " + root.toAbsolutePath());
        List<String> hits = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String text = Files.readString(file, StandardCharsets.UTF_8);
                for (String word : FORBIDDEN) {
                    if (text.contains(word)) {
                        hits.add(root.relativize(file) + " contains " + word);
                    }
                }
            }
        }
        assertEquals(List.of(), hits, "registry or payload API found in main sources");
    }
}
