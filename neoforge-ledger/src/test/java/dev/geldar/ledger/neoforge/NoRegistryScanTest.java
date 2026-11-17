package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Keeps the mod server-only and vanilla-client compatible: no registry entries (which the client must
 * sync), no network payloads and no mixins. Scans the main sources and resources for the registry and
 * payload APIs by name, case-insensitively.
 */
class NoRegistryScanTest {
    private static final List<String> FORBIDDEN = List.of(
            "DeferredRegister", "RegisterEvent", "registerPayload", "PayloadRegistrar",
            "RegisterPayloadHandlersEvent", "CustomPacketPayload", ".registrar(", "playToClient",
            "playToServer", "playBidirectional", "DeferredHolder", "DeferredBlock", "DeferredItem",
            "BuiltInRegistries", "Registry.register", "NetworkRegistry", "RegistryObject");

    private static final Path JAVA_ROOT = Path.of("src", "main", "java");
    private static final Path RESOURCE_ROOT = Path.of("src", "main", "resources");

    @Test
    void mainSourcesIntroduceNoRegistriesOrPayloads() throws IOException {
        assertEquals(List.of(), scan(JAVA_ROOT, ".java"), "registry or payload API found in main sources");
    }

    @Test
    void mainResourcesIntroduceNoRegistriesOrPayloads() throws IOException {
        assertEquals(List.of(), scan(RESOURCE_ROOT, null), "registry or payload API found in main resources");
    }

    @Test
    void mainResourcesHaveNoMixinConfig() throws IOException {
        assertTrue(Files.isDirectory(RESOURCE_ROOT), "scan root missing: " + RESOURCE_ROOT.toAbsolutePath());
        List<String> mixins = new ArrayList<>();
        try (Stream<Path> files = Files.walk(RESOURCE_ROOT)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                String name = RESOURCE_ROOT.relativize(file).toString();
                if (name.toLowerCase(Locale.ROOT).contains("mixin")) {
                    mixins.add(name);
                }
            }
        }
        assertEquals(List.of(), mixins, "mixin config found in main resources");
    }

    /** One hit per file and forbidden word; a null extension scans every regular file under the root. */
    private static List<String> scan(Path root, String extension) throws IOException {
        assertTrue(Files.isDirectory(root), "scan root missing: " + root.toAbsolutePath());
        List<String> hits = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                if (extension != null && !file.toString().endsWith(extension)) {
                    continue;
                }
                String text = Files.readString(file, StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
                for (String word : FORBIDDEN) {
                    if (text.contains(word.toLowerCase(Locale.ROOT))) {
                        hits.add(root.relativize(file) + " contains " + word);
                    }
                }
            }
        }
        return hits;
    }
}
