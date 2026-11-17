package dev.geldar.ledger.paper.curated;

import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.fake;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.player;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.world;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.destroystokyo.paper.event.server.ServerExceptionEvent;
import com.destroystokyo.paper.exception.ServerException;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bukkit.Location;
import org.bukkit.Raid;
import org.bukkit.command.CommandSender;
import org.bukkit.event.Event;
import org.bukkit.event.raid.RaidFinishEvent;
import org.bukkit.event.raid.RaidTriggerEvent;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.event.server.PluginEnableEvent;
import org.bukkit.event.server.TabCompleteEvent;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.Test;

/**
 * Compile-only here: nothing is registered against a live PluginManager (scratch row V6). Events are built from
 * Proxy fakes whose unlisted methods throw, so a handler that reads the sender, the completions or an address fails.
 */
class MiscFamilyTest {
    static final String SECRET = "pass" + "word=hunter" + 2;

    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
    final AtomicLong clock = new AtomicLong(1_000_000_000L);
    final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
    final CuratedRegistry registry = new CuratedRegistry(
            ledger.events(),
            ledger.guard("curated"),
            host,
            new CuratedRegistry.Binder() {
                @Override
                public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignore) {
                    executors.put(type, executor);
                }

                @Override
                public void unbindAll() {
                    executors.clear();
                }
            });

    /** ServerEvent and ServerExceptionEvent read Bukkit.isPrimaryThread() in their constructor: install a minimal fake. */
    static synchronized void ensureServer() {
        if (org.bukkit.Bukkit.getServer() != null) {
            return;
        }
        org.bukkit.Server server = fake(
                org.bukkit.Server.class,
                Map.of(
                        "isPrimaryThread", true,
                        "getLogger", java.util.logging.Logger.getLogger("misc-family-test"),
                        "getName", "fake",
                        "getVersion", "0",
                        "getBukkitVersion", "0"));
        try {
            org.bukkit.Bukkit.setServer(server);
        } catch (RuntimeException afterAssignment) {
            // setServer assigns the server, then fails reading the build info it logs; the assignment is all we need.
            assertNotNull(org.bukkit.Bukkit.getServer());
        }
    }

    MiscFamilyTest() {
        ensureServer();
        new MiscFamily(clock::get).register(registry);
    }

    void fire(Class<?> type, Event e) throws Exception {
        executors.get(type).execute(new org.bukkit.event.Listener() {}, e);
    }

    static Raid raid(int x, int z, int wave) {
        return fake(Raid.class, Map.of("getLocation", new Location(null, x, 70, z), "getSpawnedGroups", wave));
    }

    static Plugin plugin(String name) {
        return fake(Plugin.class, Map.of("getName", name));
    }

    static ServerExceptionEvent exceptionEvent(Throwable cause) {
        return new ServerExceptionEvent(new ServerException("outer", cause));
    }

    /** A cause whose message holds a secret and whose accessors fail the test if read. */
    static final class Secretive extends RuntimeException {
        Secretive() {
            super(SECRET);
        }

        @Override
        public String getMessage() {
            throw new AssertionError("exception message must never be read");
        }

        @Override
        public String getLocalizedMessage() {
            throw new AssertionError("exception message must never be read");
        }
    }

    @Test
    void registersSixEventsWithNoRejectedKeys() {
        assertEquals(6, registry.registeredCount());
        assertTrue(ledger.rejectedEventKeys().isEmpty());
    }

    @Test
    void raidCarriesRoundedLocationAndWaveOnly() throws Exception {
        fire(RaidTriggerEvent.class, new RaidTriggerEvent(raid(-12, 40, 3), world(), player("ag_mira_01")));
        fire(RaidFinishEvent.class, new RaidFinishEvent(raid(7, -9, 5), world(), List.of()));
        var t = ledger.events("geldar.raid.trigger").get(0);
        assertEquals(-12, t.a());
        assertEquals(40, t.b());
        assertEquals(3, t.c());
        assertEquals("ag_mira_01", t.s1());
        assertEquals("world_nether", t.s3());
        var f = ledger.events("geldar.raid.finish").get(0);
        assertEquals(7, f.a());
        assertEquals(-9, f.b());
        assertEquals(5, f.c());
        assertNull(f.s1());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void raidTriggerByAHumanNameRecordsNoName() throws Exception {
        fire(RaidTriggerEvent.class, new RaidTriggerEvent(raid(1, 2, 1), world(), player("Notch")));
        assertNull(ledger.events("geldar.raid.trigger").get(0).s1());
    }

    @Test
    void tabCompleteRecordsLengthAndKindNeverTheText() throws Exception {
        CommandSender console = fake(CommandSender.class, Map.of());
        String buffer = "/login " + SECRET;
        // getCompletions, getSender fields other than the instanceof check, and every address getter would throw.
        fire(TabCompleteEvent.class, new TabCompleteEvent(console, buffer, List.of("x")));
        fire(TabCompleteEvent.class, new TabCompleteEvent(player("ag_mira_01"), "/me", List.of("y")));
        var got = ledger.events("geldar.tabcomplete");
        assertEquals(buffer.length(), got.get(0).a());
        assertEquals("console", got.get(0).s2());
        assertEquals(3, got.get(1).a());
        assertEquals("player", got.get(1).s2());
        for (var r : got) {
            assertNull(r.s1());
            assertNull(r.s3());
            assertFalse(String.valueOf(r.s2()).contains("hunter"));
        }
        assertEquals(0, registry.errorCount());
    }

    @Test
    void tabCompleteIsRateLimitedAndBounded() throws Exception {
        CommandSender console = fake(CommandSender.class, Map.of());
        for (int i = 0; i < 500; i++) {
            fire(TabCompleteEvent.class, new TabCompleteEvent(console, "/" + "a".repeat(40_000), List.of()));
        }
        var got = ledger.events("geldar.tabcomplete");
        assertEquals(MiscFamily.TAB_PER_SECOND, got.size());
        assertEquals(MiscFamily.LENGTH_CAP, got.get(0).a());
        clock.addAndGet(1_000_000_001L);
        fire(TabCompleteEvent.class, new TabCompleteEvent(console, "/x", List.of()));
        assertEquals(MiscFamily.TAB_PER_SECOND + 1, ledger.events("geldar.tabcomplete").size());
    }

    @Test
    void pluginLifecycleRecordsCappedNameOnly() throws Exception {
        fire(PluginEnableEvent.class, new PluginEnableEvent(plugin("CoreProtect")));
        fire(PluginDisableEvent.class, new PluginDisableEvent(plugin("N".repeat(500))));
        assertEquals("CoreProtect", ledger.events("geldar.server.plugin_enabled").get(0).s2());
        assertEquals("N".repeat(MiscFamily.NAME_CAP), ledger.events("geldar.server.plugin_disabled").get(0).s2());
        assertEquals(0, registry.errorCount());
    }

    @Test
    void exceptionRecordsClassAndFirstFrameNotTheMessage() throws Exception {
        fire(ServerExceptionEvent.class, exceptionEvent(new Secretive()));
        var got = ledger.events("geldar.server.exception");
        assertEquals(1, got.size());
        assertTrue(got.get(0).s2().endsWith("MiscFamilyTest$Secretive"));
        assertNotNull(got.get(0).s3());
        assertFalse(got.get(0).s3().contains("hunter"));
        assertEquals(0, registry.errorCount());
    }

    @Test
    void exceptionFloodIsBoundedPerSecond() throws Exception {
        for (int i = 0; i < 1000; i++) {
            fire(ServerExceptionEvent.class, exceptionEvent(new IllegalStateException()));
        }
        assertEquals(MiscFamily.EXCEPTION_PER_SECOND, ledger.events("geldar.server.exception").size());
        clock.addAndGet(1_000_000_001L);
        fire(ServerExceptionEvent.class, exceptionEvent(new IllegalStateException()));
        assertEquals(MiscFamily.EXCEPTION_PER_SECOND + 1, ledger.events("geldar.server.exception").size());
    }

    @Test
    void reentrantExceptionExtractionIsSkippedAndTheOuterOneCompletes() {
        List<Boolean> innerSkipped = new ArrayList<>();
        RuntimeException recursing = new RuntimeException() {
            @Override
            public StackTraceElement[] getStackTrace() {
                CuratedRegistry.FieldSink inner = new CuratedRegistry.FieldSink();
                MiscFamily.exception(inner, this);
                innerSkipped.add(inner.s2 == null);
                return new StackTraceElement[] {new StackTraceElement("a.B", "run", "B.java", 1)};
            }
        };
        CuratedRegistry.FieldSink outer = new CuratedRegistry.FieldSink();
        MiscFamily.exception(outer, recursing);
        assertEquals(List.of(true), innerSkipped);
        assertEquals("a.B.run", outer.s3);
        // The flag is released: a later extraction works.
        CuratedRegistry.FieldSink later = new CuratedRegistry.FieldSink();
        MiscFamily.exception(later, new IllegalStateException());
        assertEquals("java.lang.IllegalStateException", later.s2);
    }

    @Test
    void throwingStackTraceIsSwallowedAndReleasesTheFlag() {
        RuntimeException bad = new RuntimeException() {
            @Override
            public StackTraceElement[] getStackTrace() {
                throw new IllegalStateException("boom");
            }
        };
        CuratedRegistry.FieldSink s = new CuratedRegistry.FieldSink();
        MiscFamily.exception(s, bad);
        CuratedRegistry.FieldSink later = new CuratedRegistry.FieldSink();
        MiscFamily.exception(later, new IllegalStateException());
        assertEquals("java.lang.IllegalStateException", later.s2);
    }

    @Test
    void stopUnbindsEverything() {
        registry.unbindAll();
        assertTrue(executors.isEmpty());
    }

    @Test
    void sourceNeverMutatesReadsTextOrInstallsHandlers() throws Exception {
        String src = Files.readString(Path.of("src/main/java/dev/geldar/ledger/paper/curated/MiscFamily.java"));
        // Strip comments and Javadoc: only code is scanned.
        String code = src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        assertFalse(Pattern.compile("\\.set[A-Z]\\w*\\(").matcher(code).find(), "no setter call");
        for (String banned : List.of(
                "getMessage", "getLocalizedMessage", "getCompletions", "getAddress", "getHostAddress", "sendMessage",
                "setDefaultUncaught", "addAppender", "addHandler", "toString()")) {
            assertFalse(code.contains(banned), banned);
        }
        // The buffer is only ever measured, never stored.
        Matcher m = Pattern.compile("getBuffer\\(\\)(.{0,10})").matcher(code);
        int n = 0;
        while (m.find()) {
            n++;
            String after = m.group(1);
            assertTrue(after.startsWith(" == null") || after.startsWith(".length()"), after);
        }
        assertTrue(n >= 2);
    }
}
