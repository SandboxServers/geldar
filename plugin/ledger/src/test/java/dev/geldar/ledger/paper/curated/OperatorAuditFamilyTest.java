package dev.geldar.ledger.paper.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.destroystokyo.paper.event.server.WhitelistToggleEvent;
import com.destroystokyo.paper.profile.PlayerProfile;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.Redactor;
import io.papermc.paper.event.server.WhitelistStateUpdateEvent;
import io.papermc.paper.event.server.WhitelistStateUpdateEvent.WhitelistStatus;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.event.Event;
import org.bukkit.event.server.BroadcastMessageEvent;
import org.bukkit.event.server.RemoteServerCommandEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

/**
 * The events are built for real (their constructors need no server). Compile-only: the Paper dispatch (which events
 * reach which handler list, the real console sender) is scratch rows X4 to X6.
 */
class OperatorAuditFamilyTest {
    // Built at runtime so no address literal sits in the source.
    static final String ADDR = String.join(".", "10", "20", "30", "40") + ":" + (25000 + 575);

    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
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

    OperatorAuditFamilyTest() {
        new OperatorAuditFamily().register(registry);
    }

    /** A sender whose every method throws, except toString, which leaks an address (it must never be read). */
    static CommandSender sender() {
        return (CommandSender) Proxy.newProxyInstance(
                CommandSender.class.getClassLoader(), new Class<?>[] {CommandSender.class}, (p, m, a) -> {
                    if (m.getName().equals("toString")) {
                        return "RemoteConsole@" + ADDR;
                    }
                    if (m.getName().equals("hashCode")) {
                        return 1;
                    }
                    if (m.getName().equals("equals")) {
                        return p == a[0];
                    }
                    throw new UnsupportedOperationException(m.getName());
                });
    }

    /**
     * ServerCommandEvent' s constructor reads Bukkit.isPrimaryThread(), which needs a running server, so the events are
     * allocated without a constructor and their fields set (compile-only for the real constructor path: scratch rows X4 to X6).
     */
    static <E extends ServerCommandEvent> E make(Class<E> type, String text) {
        try {
            java.lang.reflect.Field u = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
            u.setAccessible(true);
            E e = type.cast(((sun.misc.Unsafe) u.get(null)).allocateInstance(type));
            java.lang.reflect.Field c = ServerCommandEvent.class.getDeclaredField("command");
            c.setAccessible(true);
            c.set(e, text);
            java.lang.reflect.Field s = ServerCommandEvent.class.getDeclaredField("sender");
            s.setAccessible(true);
            s.set(e, sender());
            return e;
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError(ex);
        }
    }

    static ServerCommandEvent console(String text) {
        return make(ServerCommandEvent.class, text);
    }

    static RemoteServerCommandEvent remote(String text) {
        return make(RemoteServerCommandEvent.class, text);
    }

    void fire(Class<?> type, Event e) throws Exception {
        executors.get(type).execute(new org.bukkit.event.Listener() {}, e);
    }

    RecordingLedger.EventRecord only(String name) {
        List<RecordingLedger.EventRecord> got = ledger.events(name);
        assertEquals(1, got.size(), name);
        return got.get(0);
    }

    @Test
    void registersFiveEventsWithNoRejectedKeysAndTheExactNames() {
        assertEquals(5, registry.registeredCount());
        assertTrue(ledger.rejectedEventKeys().isEmpty());
        assertEquals(List.of("geldar.command", "geldar.subtype"), ledger.eventFields("geldar.rcon.command").stream().filter(k -> k != null).toList());
        assertEquals(List.of("geldar.text"), ledger.eventFields("geldar.broadcast").stream().filter(k -> k != null).toList());
        assertFalse(ledger.eventFields("geldar.console.command").isEmpty());
    }

    @Test
    void rconEventCarriesTheExactEventNameAndKindAndTheCommandText() throws Exception {
        fire(RemoteServerCommandEvent.class, remote("say hello world"));
        RecordingLedger.EventRecord r = only("geldar.rcon.command");
        assertEquals("say hello world", r.s1());
        assertEquals("rcon", r.s2());
        assertNull(r.s3());
        assertEquals(0, registry.errorCount());
        assertTrue(ledger.events("geldar.console.command").isEmpty());
    }

    @Test
    void noRecordedStringContainsTheSenderObjectStringOrAnAddress() throws Exception {
        fire(RemoteServerCommandEvent.class, remote("list"));
        fire(ServerCommandEvent.class, console("list"));
        for (RecordingLedger.EventRecord r : ledger.allEvents()) {
            for (String s : new String[] {r.s1(), r.s2(), r.s3()}) {
                assertTrue(s == null || (!s.contains(ADDR) && !s.contains("RemoteConsole") && !s.contains("30.40")), s);
            }
        }
        assertEquals(0, registry.errorCount());
    }

    @Test
    void consoleAndRconEachYieldExactlyOneRecord() throws Exception {
        fire(ServerCommandEvent.class, console("list"));
        // A remote event reaching the console executor (a shared handler list) is skipped, so it is recorded once.
        fire(ServerCommandEvent.class, remote("list"));
        fire(RemoteServerCommandEvent.class, remote("list"));
        assertEquals("console", only("geldar.console.command").s2());
        assertEquals("rcon", only("geldar.rcon.command").s2());
        assertEquals(2, ledger.allEvents().size());
    }

    @Test
    void authCommandArgumentsAreDroppedWholeAndOnlyTheRootIsExported() throws Exception {
        String secret = "pw" + "Zq7" + "Xk";
        for (String root : OperatorAuditFamily.AUTH_ROOTS) {
            assertEquals(root, OperatorAuditFamily.exportable("/" + root.toUpperCase() + " " + secret + " " + secret));
        }
        assertEquals("login", OperatorAuditFamily.exportable("authme:login " + secret));
        assertEquals("authme", OperatorAuditFamily.exportable("  AuthMe register bob " + secret));
        assertEquals("login", OperatorAuditFamily.exportable("login " + secret));
        assertEquals("register", OperatorAuditFamily.exportable("register\t" + secret));
        assertEquals("l", OperatorAuditFamily.exportable("l " + secret));
        fire(RemoteServerCommandEvent.class, remote("changepassword old" + secret + " new" + secret));
        assertEquals("changepassword", only("geldar.rcon.command").s1());
        // a command that merely starts with an auth word is not an auth command
        assertTrue(OperatorAuditFamily.exportable("login2 x").startsWith("login2"));
    }

    @Test
    void aCredentialLookingArgumentIsScrubbedBeforeTheRing() throws Exception {
        String secret = "Zq9xK2mP" + "7vL4AbR5tY";
        fire(ServerCommandEvent.class, console("give --password " + secret + " token=" + secret + "9"));
        String got = only("geldar.console.command").s1();
        assertFalse(got.contains(secret), got);
        assertTrue(got.contains("[redacted]"), got);
        // a plain-text secret in a non-auth command is content and stays (documented limit)
        assertEquals("op alice", OperatorAuditFamily.exportable("op alice"));
        String plain = "rcon.password=hunter2";
        assertEquals(Redactor.scrub(plain), OperatorAuditFamily.exportable(plain));
        // an address in a command is masked
        assertFalse(OperatorAuditFamily.exportable("ban-ip " + ADDR.substring(0, ADDR.indexOf(':'))).contains("30.40"));
    }

    @Test
    void anOversizedCommandIsBoundedWithATruncationMarker() throws Exception {
        String big = "say " + "x".repeat(300_000);
        fire(RemoteServerCommandEvent.class, remote(big));
        String got = only("geldar.rcon.command").s1();
        assertTrue(got.getBytes(StandardCharsets.UTF_8).length <= OperatorAuditFamily.TEXT_MAX_BYTES, "len " + got.length());
        assertTrue(got.contains("[truncated:"), got.substring(got.length() - 30));
        // multi-byte text stays within the byte bound
        String wide = OperatorAuditFamily.exportable("say " + "é".repeat(5000));
        assertTrue(wide.getBytes(StandardCharsets.UTF_8).length <= OperatorAuditFamily.TEXT_MAX_BYTES);
    }

    @Test
    void nullAndEmptyCommandsAreEmptyNotErrors() throws Exception {
        assertEquals("", OperatorAuditFamily.exportable(null));
        assertEquals("", OperatorAuditFamily.exportable("   "));
        assertEquals("", OperatorAuditFamily.root(""));
        fire(ServerCommandEvent.class, console(""));
        assertEquals(0, registry.errorCount());
    }

    @Test
    void broadcastRecordsScrubbedPlainText() throws Exception {
        String secret = "Zq9xK2mP" + "7vL4AbR5tY";
        fire(BroadcastMessageEvent.class, new BroadcastMessageEvent(Component.text("restart in 5 password=" + secret), Set.of()));
        String got = only("geldar.broadcast").s1();
        assertTrue(got.startsWith("restart in 5"), got);
        assertFalse(got.contains(secret), got);
    }

    @Test
    void whitelistExportsOnlyALifeIdAndTheStatus() throws Exception {
        fire(WhitelistStateUpdateEvent.class, new WhitelistStateUpdateEvent(profile("ag_mira_01"), WhitelistStatus.ADDED));
        fire(WhitelistStateUpdateEvent.class, new WhitelistStateUpdateEvent(profile("HumanName"), WhitelistStatus.REMOVED));
        List<RecordingLedger.EventRecord> got = ledger.events("geldar.whitelist.update");
        assertEquals(2, got.size());
        assertEquals("ag_mira_01", got.get(0).s1());
        assertEquals("ADDED", got.get(0).s2());
        assertNull(got.get(1).s1());
        assertEquals("REMOVED", got.get(1).s2());
        fire(WhitelistToggleEvent.class, new WhitelistToggleEvent(true));
        assertEquals(1, only("geldar.whitelist.toggle").c());
        assertEquals(0, registry.errorCount());
    }

    static PlayerProfile profile(String name) {
        return (PlayerProfile) Proxy.newProxyInstance(
                PlayerProfile.class.getClassLoader(), new Class<?>[] {PlayerProfile.class}, (p, m, a) -> {
                    if (m.getName().equals("getName")) {
                        return name;
                    }
                    if (m.getName().equals("toString")) {
                        return "profile";
                    }
                    throw new UnsupportedOperationException(m.getName());
                });
    }

    @Test
    void theSourceHasNoSetterNoDispatchAndNoRconConfigurationRead() throws IOException {
        String src = Files.readString(Path.of("src/main/java/dev/geldar/ledger/paper/curated/OperatorAuditFamily.java"));
        String code = src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        for (String banned : List.of(
                "setCancelled", "setCommand", "setMessage", "dispatchCommand", "getSender", "getAddress", "getRemote",
                "rcon.password", "rcon.port", "server.properties", "getProperty", "sendMessage", "getServerProperties")) {
            assertFalse(code.contains(banned), banned);
        }
        assertFalse(code.matches("(?s).*\\.set[A-Z].*"), "a setter call");
        assertTrue(src.lines().count() < 500);
    }
}
