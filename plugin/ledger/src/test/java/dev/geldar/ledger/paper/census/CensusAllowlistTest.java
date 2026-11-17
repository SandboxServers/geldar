package dev.geldar.ledger.paper.census;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.junit.jupiter.api.Test;

/** The checked-in census allow-list matches the pinned paper-api and honours the exclusions (S10). */
class CensusAllowlistTest {
    /** Upper bound on the list; a jump past it means the generator rule loosened, not that Paper grew. */
    static final int CAP = 450;

    private static final int FLOOR = 200;

    private static List<String> checkedIn() throws IOException {
        try (InputStream in = CensusAllowlistTest.class.getResourceAsStream("/ledger/census-allowlist.txt")) {
            assertTrue(in != null, "census-allowlist.txt missing from resources");
            String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            return body.isEmpty() ? List.of() : List.of(body.stripTrailing().split("\n"));
        }
    }

    @Test
    void checkedInFileMatchesPaperApi() throws IOException {
        assertEquals(
                CensusAllowlistGenerator.compute(),
                checkedIn(),
                "paper-api changed: run ./gradlew :ledger:generateCensusAllowlist");
    }

    @Test
    void fileIsSortedWithNoDuplicatesAndBounded() throws IOException {
        List<String> names = checkedIn();
        assertEquals(names.stream().sorted().toList(), names);
        assertEquals(names.size(), new HashSet<>(names).size());
        assertTrue(names.size() >= FLOOR, "too few classes: " + names.size());
        assertTrue(names.size() <= CAP, "over the cap: " + names.size());
    }

    @Test
    void shapeIsEventClassNamesOnly() throws IOException {
        for (String name : checkedIn()) {
            assertTrue(name.matches("[a-z][a-z0-9_.]*\\.[A-Z][A-Za-z0-9]*Event"), "unexpected entry: " + name);
        }
    }

    @Test
    void noExcludedClassIsListed() throws IOException {
        for (String name : checkedIn()) {
            String simple = name.substring(name.lastIndexOf('.') + 1);
            assertFalse(CensusExclusions.NAMES.contains(simple), "excluded class listed: " + name);
        }
    }

    @Test
    void exclusionsAreExactlyTheGatedSet() {
        assertEquals(17, CensusExclusions.NAMES.size());
        for (String n : List.of(
                "BlockPhysicsEvent", "EntityMoveEvent", "InventoryMoveItemEvent", "HopperInventorySearchEvent",
                "PlayerChunkLoadEvent", "PlayerChunkUnloadEvent", "PlayerTrackEntityEvent",
                "PlayerUntrackEntityEvent", "BlockDestroyEvent", "PlayerInventorySlotChangeEvent",
                "PlayerRecipeBookClickEvent", "PlayerSignOpenEvent", "ItemTransportingEntityValidateTargetEvent",
                "AsyncPlayerConnectionConfigureEvent", "AsyncPlayerChatEvent", "PlayerChatEvent",
                "PlayerLoginEvent")) {
            assertTrue(CensusExclusions.NAMES.contains(n), n);
        }
    }

    @Test
    void deprecatedClassesAreExcluded() {
        assertTrue(CensusExclusions.isExcluded(Old.class));
        assertTrue(CensusExclusions.isExcluded(PlayerLoginEvent.class));
        assertFalse(CensusExclusions.isExcluded(PlayerJoinEvent.class));
    }

    @Test
    void knownEventsArePresent() throws IOException {
        List<String> names = checkedIn();
        assertTrue(names.contains(BlockBreakEvent.class.getName()));
        assertTrue(names.contains(PlayerJoinEvent.class.getName()));
    }

    @Test
    void generatedListNeverContainsAnExcludedClass() throws IOException {
        assertFalse(CensusAllowlistGenerator.compute().contains(PlayerLoginEvent.class.getName()));
    }

    @Deprecated
    private static final class Old {}
}
