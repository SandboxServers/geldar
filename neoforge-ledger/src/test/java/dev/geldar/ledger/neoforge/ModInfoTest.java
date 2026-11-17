package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ModInfoTest {
    private static String read(String first, String... more) throws IOException {
        return Files.readString(Path.of(first, more));
    }

    @Test
    void modIdIsLedgerAndServerOnly() throws IOException {
        String toml = read("src", "main", "resources", "META-INF", "neoforge.mods.toml");
        assertTrue(toml.contains("modId = \"ledger\""));
        assertTrue(toml.contains("[[dependencies.ledger]]"));
        assertEquals(2, toml.split("side = \"SERVER\"", -1).length - 1);
        assertFalse(toml.contains("side = \"CLIENT\"") || toml.contains("side = \"BOTH\""));
        assertTrue(toml.contains("loaderVersion = \"[11,)\""));
    }

    @Test
    void entryPointIsDedicatedServerOnly() throws IOException {
        String src = read("src", "main", "java", "dev", "geldar", "ledger", "neoforge", "LedgerMod.java");
        assertTrue(src.contains("@Mod(value = \"ledger\", dist = Dist.DEDICATED_SERVER)"));
    }

    @Test
    void noSecondCopyOfTheNeoForgeVersion() throws IOException {
        assertFalse(read("gradle.properties").contains("neoforge.version="));
        assertTrue(read("..", "neoforge", "gradle.properties").contains("neoforge.version="));
    }

    @Test
    void wrapperMatchesTheNeoForgeWrapper() throws IOException {
        assertEquals(read("..", "neoforge", "gradle", "wrapper", "gradle-wrapper.properties"),
                read("gradle", "wrapper", "gradle-wrapper.properties"));
    }
}