package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.jupiter.api.Test;

/**
 * The optional census.gradle.kts hook: a later card adds the file without editing build.gradle.kts. Applying a present
 * file is not exercised by a Gradle run here (known gap, see plugin/README.md); this pins the guarded apply by name.
 */
class CensusHookTest {
    private static final String HOOK =
            "if (file(\"census.gradle.kts\").exists()) apply(from = \"census.gradle.kts\")";

    @Test
    void buildScriptAppliesCensusFileOnlyWhenPresent() throws IOException {
        String script = Files.readString(Paths.get(System.getProperty("ledger.build.script")));
        assertTrue(script.contains(HOOK), "guarded census hook missing from build.gradle.kts");
        assertEquals(1, script.split("census\\.gradle\\.kts\"\\)\\.exists\\(\\)", -1).length - 1);
        assertEquals(1, script.split("apply\\(from = \"census\\.gradle\\.kts\"\\)", -1).length - 1);
    }
}