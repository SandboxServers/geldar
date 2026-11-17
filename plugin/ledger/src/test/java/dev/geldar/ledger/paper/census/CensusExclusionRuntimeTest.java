package dev.geldar.ledger.paper.census;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.census.CensusCounters;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.logging.Logger;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** The real allow-list through the real collector with a fake registrar. */
class CensusExclusionRuntimeTest {
    /** Written out here on purpose: not read from CensusExclusions. */
    private static final Set<String> EXCLUDED = Set.of(
            "BlockPhysicsEvent",
            "EntityMoveEvent",
            "InventoryMoveItemEvent",
            "HopperInventorySearchEvent",
            "PlayerChunkLoadEvent",
            "PlayerChunkUnloadEvent",
            "PlayerTrackEntityEvent",
            "PlayerUntrackEntityEvent",
            "BlockDestroyEvent",
            "PlayerInventorySlotChangeEvent",
            "PlayerRecipeBookClickEvent",
            "PlayerSignOpenEvent",
            "ItemTransportingEntityValidateTargetEvent",
            "AsyncPlayerConnectionConfigureEvent",
            "AsyncPlayerChatEvent",
            "PlayerChatEvent",
            "PlayerLoginEvent");

    private static List<String> resourceLines() throws IOException {
        try (InputStream in = CensusCollector.class.getResourceAsStream(CensusCollector.RESOURCE)) {
            assertTrue(in != null, "allow-list is not on the classpath at " + CensusCollector.RESOURCE);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(s -> !s.isBlank()).toList();
        }
    }

    @Test
    void theResourceOnTheClasspathEqualsTheCheckedInList() throws IOException {
        Path script = Paths.get(System.getProperty("ledger.build.script"));
        Path file = script.getParent().resolve("src/main/resources/ledger/census-allowlist.txt");
        assertEquals(Files.readAllLines(file).stream().filter(s -> !s.isBlank()).toList(), resourceLines());
    }

    @Test
    void realAllowListRegistersEveryClassAndNoExcludedOne() throws IOException {
        List<String> names = resourceLines();
        assertTrue(names.size() > 300, "allow-list size " + names.size());
        CensusCollectorTest.FakeRegistrar registrar = new CensusCollectorTest.FakeRegistrar();
        FakeHostInfo host = new FakeHostInfo();
        Properties p = new Properties();
        p.setProperty("collector.census.enabled", "true");
        LedgerConfig config = ConfigParser.parse(p).config();
        RecordingLedger ledger = new RecordingLedger(host, config);
        CensusCollector collector = new CensusCollector(
                () -> names, () -> registrar, getClass().getClassLoader(), () -> Logger.getAnonymousLogger());
        FakeHostScheduler scheduler = new FakeHostScheduler();
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
        assertEquals(names.size(), registrar.executors.size());
        assertEquals(0, collector.skippedCount());
        for (Class<?> c : registrar.executors.keySet()) {
            assertFalse(EXCLUDED.contains(c.getSimpleName()), c.getName());
            assertFalse(c.isAnnotationPresent(Deprecated.class), c.getName());
        }
        collector.stop();
        assertEquals(0, registrar.executors.size());
    }

    @Test
    void realAllowListLabelsAreUniqueAndAcceptedByTheCounters() throws IOException {
        List<String> names = resourceLines();
        List<String> labels = CensusCollector.labels(names);
        assertEquals(names.size(), labels.stream().distinct().count());
        assertEquals(names.size(), new CensusCounters(new RecordingLedger(), labels).size());
    }

    @Test
    void censusSourcesNeverReadEventContent() throws IOException {
        Path script = Paths.get(System.getProperty("ledger.build.script"));
        Path dir = script.getParent().resolve("src/main/java/dev/geldar/ledger/paper/census");
        List<String> bad = new ArrayList<>();
        String forbidden = "\\.(getPlayer|getEntity|getBlock|getMessage|getWorld|getItem|getLocation|getFrom|getTo"
                + "|getDamager|getCause|getEntities|getInventory|getView|getCommand|getRecipients|getName|getUniqueId)\\s*\\(";
        try (Stream<Path> files = Files.list(dir)) {
            for (Path f : files.filter(x -> x.toString().endsWith(".java")).toList()) {
                String src = Files.readString(f);
                if (java.util.regex.Pattern.compile(forbidden).matcher(src).find()) {
                    bad.add(f.getFileName().toString());
                }
            }
        }
        assertEquals(List.of(), bad);
    }
}
