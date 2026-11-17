package dev.geldar.core.lakitu;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * A static scan of every source file in the lakitu package. Each pattern is an invariant: the feed creates
 * nothing visible (I1) and changes nothing (I2). Comments are scanned too, so the words stay out of the package.
 */
class LakituReadOnlyTest {
    private static final Path ROOT = Path.of("src/main/java/dev/geldar/core/lakitu");

    private static final List<Pattern> BANNED = List.of(
            Pattern.compile("setCancelled"),
            Pattern.compile("teleport"),
            Pattern.compile("spawn"),
            Pattern.compile("setPlayerListName"),
            Pattern.compile("setScoreboard"),
            Pattern.compile("Scoreboard"),
            Pattern.compile("BossBar"),
            Pattern.compile("broadcastMessage"),
            Pattern.compile("sendMessage"),
            // Any chunk accessor that loads or generates; the reader asks isChunkLoaded and reads blocks only.
            Pattern.compile("getChunkAt"),
            Pattern.compile("loadChunk"),
            Pattern.compile("ChunkTicket"),
            Pattern.compile("setType"),
            Pattern.compile("dispatchCommand"),
            Pattern.compile("EventPriority\\.LOWEST"),
            Pattern.compile("EventPriority\\.HIGHEST"),
            Pattern.compile("EventPriority\\.(LOW|NORMAL|HIGH)\\b"));

    private static List<Path> sources() throws IOException {
        try (Stream<Path> s = Files.walk(ROOT)) {
            return s.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }

    @Test
    void thePackageHasSourcesToScan() throws IOException {
        assertTrue(sources().size() >= 5, "the scan must find the lakitu sources, from " + ROOT.toAbsolutePath());
    }

    @Test
    void noLakituSourceUsesABannedName() throws IOException {
        List<String> hits = new ArrayList<>();
        for (Path file : sources()) {
            String text = Files.readString(file);
            for (Pattern banned : BANNED) {
                if (banned.matcher(text).find()) {
                    hits.add(file.getFileName() + " contains " + banned.pattern());
                }
            }
        }
        assertTrue(hits.isEmpty(), hits.toString());
    }

    @Test
    void everyListenerHandlerIsMonitorPriority() throws IOException {
        for (Path file : sources()) {
            String text = Files.readString(file);
            long handlers = Pattern.compile("@EventHandler").matcher(text).results().count();
            long monitors = Pattern.compile("@EventHandler\\(priority = EventPriority\\.MONITOR[,)]")
                    .matcher(text).results().count();
            assertFalse(handlers != monitors, file.getFileName() + ": every @EventHandler must be MONITOR");
        }
    }
}