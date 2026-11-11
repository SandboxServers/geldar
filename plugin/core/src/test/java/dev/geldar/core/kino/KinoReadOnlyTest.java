package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

/** A static scan of the kino package (comments included): nothing visible, no input path, no loading. */
class KinoReadOnlyTest {
    private static final Path ROOT = Path.of("src/main/java/dev/geldar/core/kino");

    private static final List<Pattern> BANNED = List.of(
            Pattern.compile("setCancelled"), Pattern.compile("teleport"), Pattern.compile("spawn"),
            Pattern.compile("setPlayerListName"), Pattern.compile("Scoreboard"), Pattern.compile("BossBar"),
            Pattern.compile("broadcastMessage"), Pattern.compile("sendMessage"), Pattern.compile("sendPluginMessage"),
            Pattern.compile("showTitle"), Pattern.compile("sendActionBar"), Pattern.compile("addPassenger"),
            Pattern.compile("getChunkAt"), Pattern.compile("getChunkAtAsync"), Pattern.compile("loadChunk"),
            Pattern.compile("addPluginChunkTicket"), Pattern.compile("ChunkTicket"), Pattern.compile("setType"),
            Pattern.compile("setBlockData"), Pattern.compile("dispatchCommand"), Pattern.compile("performCommand"),
            Pattern.compile("EventPriority\\.(LOWEST|LOW|NORMAL|HIGH|HIGHEST)\\b"));

    private static List<Path> sources() throws IOException {
        try (Stream<Path> s = Files.walk(ROOT)) {
            return s.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }

    @Test
    void thePackageHasSourcesToScan() throws IOException {
        assertTrue(sources().size() >= 8, "from " + ROOT.toAbsolutePath());
    }

    @Test
    void noKinoSourceUsesABannedName() throws IOException {
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
            assertEquals(handlers, monitors, file.getFileName() + ": every @EventHandler must be MONITOR");
        }
    }

    @Test
    void theKinoWorldViewHasNoMutatingMethod() {
        for (var m : KinoWorld.class.getDeclaredMethods()) {
            assertFalse(Pattern.compile("^(set|load|generate|spawn|remove|place|break|teleport)").matcher(m.getName()).find(),
                    m.getName());
        }
    }

    @Test
    void theRegistrationIsBehindTheDefaultFalseKillSwitch() throws IOException {
        String core = Files.readString(Path.of("src/main/java/dev/geldar/core/GeldarCore.java"));
        // K08: Kino is always registered and applied from kino.enabled (reload starts it killed when false).
        assertTrue(core.contains("dev.geldar.core.kino.KinoSetup.reload(kino, getConfig())"));
        assertTrue(Files.readString(Path.of("src/main/resources/config.yml")).matches("(?s).*kino:\\n(  #.*\\n)?  enabled: false\\n.*"));
        assertTrue(Files.readString(ROOT.resolve("KinoSetup.java")).contains("getBoolean(\"kino.enabled\", false)"));
    }
}