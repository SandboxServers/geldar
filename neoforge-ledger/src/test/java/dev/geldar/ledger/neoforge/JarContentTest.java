package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipFile;
import org.junit.jupiter.api.Test;

/** The built mod jar must carry ledger-core and the OpenTelemetry API as jar-in-jar, or the server cannot load it. */
class JarContentTest {
    private static final Set<String> NESTED = Set.of(
            "ledger-core", "opentelemetry-api", "opentelemetry-common", "opentelemetry-context");

    @Test
    void jarHasJarJarMetadataAndTheNestedJars() throws IOException {
        Path jar = Path.of(System.getProperty("ledger.mod.jar"));
        assertTrue(Files.isRegularFile(jar), "mod jar not built: " + jar);
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            List<String> nested = zip.stream().map(e -> e.getName())
                    .filter(n -> n.startsWith("META-INF/jarjar/") && n.endsWith(".jar")).toList();
            for (String artifact : NESTED) {
                assertTrue(nested.stream().anyMatch(n -> n.contains(artifact)), "nested jar missing: " + artifact + " in " + nested);
            }
            var meta = zip.getEntry("META-INF/jarjar/metadata.json");
            assertTrue(meta != null, "META-INF/jarjar/metadata.json missing");
            String json = new String(zip.getInputStream(meta).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            for (String artifact : NESTED) {
                assertTrue(json.contains(artifact), "metadata does not name " + artifact);
            }
            assertEquals(NESTED.size(), nested.size(), "unexpected nested jars: " + nested.stream().collect(Collectors.joining(",")));
        }
    }
}