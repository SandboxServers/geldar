package dev.geldar.core.combat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class HostileMobsTest {
    /** The names quoted inside ALWAYS_HOSTILE in the golem's hostile-types.ts, in file order. */
    private static List<String> namesInTypeScript() throws IOException {
        Path schemas = Path.of(System.getProperty("geldar.schemas"));
        Path repo = schemas.getParent().getParent();
        String text = Files.readString(repo.resolve("golem/src/perception/hostile-types.ts"));
        int start = text.indexOf("ALWAYS_HOSTILE");
        int end = text.indexOf("]);", start);
        Matcher quoted = Pattern.compile("'([a-z_]+)'").matcher(text.substring(start, end));
        List<String> names = new ArrayList<>();
        while (quoted.find()) {
            names.add(quoted.group(1));
        }
        return names;
    }

    @Test
    void theListMatchesTheGolemListInOrder() throws IOException {
        List<String> golem = namesInTypeScript();

        assertEquals(28, golem.size());
        assertEquals(golem, HostileMobs.NAMES);
    }

    @Test
    void everyListedNameIsHostileAndNeutralMobsAre() {
        for (String name : HostileMobs.NAMES) {
            assertTrue(HostileMobs.isHostile(name), name);
        }
        for (String neutral : List.of("wolf", "enderman", "piglin", "zombified_piglin", "bee", "iron_golem", "spider",
                "cave_spider")) {
            assertFalse(HostileMobs.isHostile(neutral), neutral);
        }
    }

    @Test
    void lookupIsExactAndNeverNull() {
        assertFalse(HostileMobs.isHostile("Zombie"));
        assertFalse(HostileMobs.isHostile("minecraft:zombie"));
        assertFalse(HostileMobs.isHostile(""));
        assertFalse(HostileMobs.isHostile(null));
    }
}
