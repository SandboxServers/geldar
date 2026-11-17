package dev.geldar.ledger.paper.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BridgeCollectorTest {
    @TempDir
    Path tmp;

    private final Map<String, Plugin> plugins = new HashMap<>();
    private final Set<String> classMissing = new HashSet<>();
    private final FakeHostInfo host = new FakeHostInfo();
    private final RecordingLedger ledger = new RecordingLedger(host, LedgerConfig.defaults());
    private final FakeHostScheduler scheduler = new FakeHostScheduler();
    private final PluginManager manager = (PluginManager) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {PluginManager.class}, (p, m, a) -> {
                if (!m.getName().equals("getPlugin")) {
                    throw new UnsupportedOperationException(m.getName());
                }
                if (classMissing.contains((String) a[0])) {
                    throw new NoClassDefFoundError("gone");
                }
                return plugins.get((String) a[0]);
            });
    private final BridgeCollector collector = new BridgeCollector(() -> manager);

    private void plugin(String name, boolean enabled, Path dataFolder) {
        plugins.put(name, (Plugin) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Plugin.class}, (p, m, a) -> switch (m.getName()) {
                    case "isEnabled" -> enabled;
                    case "getDataFolder" -> dataFolder.toFile();
                    default -> throw new UnsupportedOperationException(m.getName());
                }));
    }

    private void start() {
        collector.start(new CollectorContext() {
            @Override
            public Ledger ledger() {
                return ledger;
            }

            @Override
            public HostScheduler scheduler() {
                return scheduler;
            }

            @Override
            public HostInfo host() {
                return host;
            }
        });
    }

    private long chunky() {
        return ledger.readGaugeLong(Names.Bridge.CHUNKY_RUNNING);
    }

    private long coreprotect() {
        return ledger.readGaugeLong(Names.Bridge.COREPROTECT_QUEUE);
    }

    private long bluemap() {
        return ledger.readGaugeLong(Names.Bridge.BLUEMAP_ENABLED);
    }

    private Path chunkyTasks() throws IOException {
        Path data = tmp.resolve("Chunky");
        Path tasks = Files.createDirectories(data.resolve("tasks"));
        plugin("Chunky", true, data);
        return tasks;
    }

    private static void write(Path f, String text) throws IOException {
        Files.writeString(f, text, StandardCharsets.UTF_8);
    }

    @Test
    void noneOfThePluginsPresentStartsAndEmitsZeros() {
        start();
        scheduler.advanceTicks(BridgeCollector.PROBE_EVERY_TICKS);
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(0, chunky());
        assertEquals(0, coreprotect());
        assertEquals(0, bluemap());
        assertFalse(collector.coreProtectPresent());
    }

    @Test
    void bluemapAndCoreprotectReportPresenceAndADisabledPluginReadsZero() {
        plugin("BlueMap", true, tmp);
        plugin("CoreProtect", false, tmp);
        start();
        assertEquals(1, bluemap());
        assertFalse(collector.coreProtectPresent());
        plugin("CoreProtect", true, tmp);
        plugin("BlueMap", false, tmp);
        scheduler.advanceTicks(BridgeCollector.PROBE_EVERY_TICKS);
        assertEquals(0, bluemap());
        assertTrue(collector.coreProtectPresent());
        assertEquals(0, coreprotect(), "the queue is presence only");
    }

    @Test
    void chunkyCountsOnlyTasksSavedAsNotCancelled() throws IOException {
        Path tasks = chunkyTasks();
        write(tasks.resolve("a.json"), "{\"world\":\"w\",\"cancelled\": false}");
        write(tasks.resolve("b.json"), "{\"cancelled\":true}");
        write(tasks.resolve("c.json"), "not json at all");
        write(tasks.resolve("d.txt"), "{\"cancelled\":false}");
        start();
        assertEquals(0, chunky(), "nothing is read before the first scan");
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(1, chunky());
        write(tasks.resolve("e.json"), "{\"cancelled\":false}");
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(2, chunky());
    }

    @Test
    void chunkyReadsAreBounded() throws IOException {
        Path tasks = chunkyTasks();
        write(tasks.resolve("big.json"), " ".repeat(ChunkyBridge.MAX_BYTES) + "{\"cancelled\":false}");
        assertEquals(0, ChunkyBridge.count(tasks), "a flag past the byte cap is not read");
        Files.delete(tasks.resolve("big.json"));
        for (int i = 0; i < ChunkyBridge.MAX_FILES + 20; i++) {
            write(tasks.resolve("t" + i + ".json"), "{\"cancelled\":false}");
        }
        assertEquals(ChunkyBridge.MAX_FILES, ChunkyBridge.count(tasks));
    }

    @Test
    void chunkyDoesNotFollowSymbolicLinks() throws IOException {
        Path tasks = chunkyTasks();
        Path outside = Files.createDirectories(tmp.resolve("outside"));
        write(outside.resolve("x.json"), "{\"cancelled\":false}");
        Path linkedDir = tmp.resolve("linkdir");
        Path linkedFile = tasks.resolve("link.json");
        try {
            Files.createSymbolicLink(linkedDir, outside);
            Files.createSymbolicLink(linkedFile, outside.resolve("x.json"));
        } catch (IOException | UnsupportedOperationException | SecurityException e) {
            org.junit.jupiter.api.Assumptions.abort("symbolic links are not available here");
        }
        assertEquals(0, ChunkyBridge.count(tasks), "a linked task file is skipped");
        assertEquals(-1, ChunkyBridge.count(linkedDir), "a linked folder is not entered");
    }

    @Test
    void aMissingChunkyFolderReadsZeroAndWorksOnceItAppears() throws IOException {
        Path data = tmp.resolve("Chunky");
        plugin("Chunky", true, data);
        start();
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(0, chunky());
        Path tasks = Files.createDirectories(data.resolve("tasks"));
        write(tasks.resolve("a.json"), "{\"cancelled\":false}");
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(1, chunky());
    }

    @Test
    void aBridgeWhoseClassLookupFailsIsSkippedAndTheOthersStillWork() throws IOException {
        Path tasks = chunkyTasks();
        write(tasks.resolve("a.json"), "{\"cancelled\":false}");
        plugin("BlueMap", true, tmp);
        plugin("CoreProtect", true, tmp);
        start();
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(1, chunky());
        classMissing.add("Chunky");
        scheduler.advanceTicks(BridgeCollector.PROBE_EVERY_TICKS);
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(0, chunky(), "the failing bridge is zeroed");
        assertEquals(1, bluemap());
        assertTrue(collector.coreProtectPresent());
    }

    @Test
    void aThrowingPluginManagerZeroesEverythingWithoutThrowing() {
        plugin("BlueMap", true, tmp);
        BridgeCollector broken = new BridgeCollector(() -> {
            throw new IllegalStateException("no server");
        });
        broken.start(new CollectorContext() {
            @Override
            public Ledger ledger() {
                return ledger;
            }

            @Override
            public HostScheduler scheduler() {
                return scheduler;
            }

            @Override
            public HostInfo host() {
                return host;
            }
        });
        scheduler.advanceTicks(BridgeCollector.PROBE_EVERY_TICKS);
        assertEquals(0, bluemap());
    }

    @Test
    void theFileScanDoesNothingOnTheMainThread() throws IOException {
        Path tasks = chunkyTasks();
        write(tasks.resolve("a.json"), "{\"cancelled\":false}");
        start();
        host.mainThread(true);
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(0, chunky());
        host.mainThread(false);
        scheduler.advanceMillis(BridgeCollector.SCAN_EVERY_MS);
        assertEquals(1, chunky());
    }

    @Test
    void stopCancelsBothTimersAndIsIdempotent() {
        start();
        assertEquals(2, scheduler.activeTasks());
        collector.stop();
        collector.stop();
        assertEquals(0, scheduler.activeTasks());
        assertEquals(2, scheduler.cancelCount());
    }

    @Test
    void theBridgesNeverCallAMutatingVerb() throws IOException {
        Pattern verbs = Pattern.compile(
                "\\.(start|pause|cancel|render|purge|restore|rollback|lookup)\\s*\\(", Pattern.CASE_INSENSITIVE);
        Path dir = Path.of("src/main/java/dev/geldar/ledger/paper/bridge");
        try (Stream<Path> files = Files.list(dir)) {
            List<Path> sources = files.filter(f -> f.toString().endsWith(".java")).toList();
            assertTrue(sources.size() >= 5, "found the sources: " + sources);
            for (Path f : sources) {
                String text = Files.readString(f, StandardCharsets.UTF_8);
                // BridgeCollector cancels its own two timers on stop; that is the only allowed hit.
                if (f.getFileName().toString().equals("BridgeCollector.java")) {
                    text = text.replace("p.cancel()", "").replace("s.cancel()", "");
                }
                assertFalse(verbs.matcher(text).find(), f + " calls a mutating verb");
            }
        }
    }
}
