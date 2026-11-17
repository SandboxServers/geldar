package dev.geldar.ledger.neoforge.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** Pure-logic tests for the PT-N8 families (the game-event readers in AuditWiring need a server and are compile-only). */
class AuditFamiliesTest {
    static final String LIFE = "ag_ada_01";
    static final String LIFE2 = "ag_bob_02";
    final FakeLedger f = new FakeLedger();
    final AtomicLong clock = new AtomicLong(1_000_000_000L);

    // --- combat ---

    @Test
    void registersGeldarNamesOnly() {
        new CombatFamily(f.ledger, f.host);
        new TextContentFamily(f.ledger, clock::get);
        new OperatorAuditFamily(f.ledger, f.host, clock::get);
        assertEquals(10, f.registered.size()); // 7 events and 3 rate-drop twins
        assertTrue(f.registered.stream().allMatch(n -> n.startsWith("geldar.")), f.registered.toString());
    }

    @Test
    void damageToALifeKeepsTheVictimRoleOne() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.damage(LIFE, null, 3.5, "mob_attack");
        Object[] e = f.events.get(0);
        assertEquals(350L, e[1]);
        assertEquals(1L, e[2]);
        assertEquals(LIFE, e[4]);
        assertEquals("mob_attack", e[5]);
    }

    @Test
    void attackerOnlyIsRoleTwo() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.damage(null, LIFE, 1, null);
        assertEquals(2L, f.events.get(0)[2]);
        assertEquals(LIFE, f.events.get(0)[4]);
        assertEquals("UNKNOWN", f.events.get(0)[5]);
    }

    @Test
    void pvpKeepsTheVictimOnly() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.damage(LIFE, LIFE2, 2, "player_attack");
        assertEquals(1, f.events.size());
        assertEquals(3L, f.events.get(0)[2]);
        assertEquals(LIFE, f.events.get(0)[4]);
        for (Object o : f.events.get(0)) {
            assertFalse(LIFE2.equals(o), "attacker id must not be exported");
        }
    }

    @Test
    void nonPlayerDamageAndHumanNamesAreNotExported() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.damage(null, null, 5, "fall");
        assertTrue(f.events.isEmpty());
        c.damage("HumanSteve", null, 5, "fall");
        assertNull(f.events.get(0)[4]);
        c.damage("HumanSteve", "Alex", 5, "fall");
        assertNull(f.events.get(1)[4]);
    }

    @Test
    void damageAmountIsClamped() {
        assertEquals(0, CombatFamily.damageX100(Double.NaN));
        assertEquals(0, CombatFamily.damageX100(-4));
        assertEquals(CombatFamily.MAX_DAMAGE_X100, CombatFamily.damageX100(1e12));
        assertEquals(150, CombatFamily.damageX100(1.5));
    }

    @Test
    void playerDeathCarriesCauseAndDimensionOnly() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.playerDeath(LIFE, "lava", "minecraft:overworld");
        Object[] e = f.events.get(0);
        assertEquals(LIFE, e[4]);
        assertEquals("lava", e[5]);
        assertEquals("minecraft:overworld", e[6]);
        c.playerDeath("HumanSteve", null, null);
        assertNull(f.events.get(1)[4]);
        assertEquals("UNKNOWN", f.events.get(1)[5]);
    }

    @Test
    void killSkipsPlayerDeathsAndMissingKillers() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        c.killed(LIFE, true, () -> "minecraft:player");
        c.killed(null, false, () -> {
            throw new AssertionError("type built without a player killer");
        });
        assertTrue(f.events.isEmpty());
        c.killed(LIFE, false, () -> "minecraft:zombie");
        assertEquals(LIFE, f.events.get(0)[4]);
        assertEquals("minecraft:zombie", f.events.get(0)[5]);
    }

    @Test
    void combatIgnoresOffThreadEventsAndHonoursTheGuard() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        f.main.set(false);
        c.damage(LIFE, null, 1, "x");
        assertTrue(f.events.isEmpty());
        assertEquals(0, f.guardBegins.get());
        f.main.set(true);
        f.guardAllowed.set(false);
        c.damage(LIFE, null, 1, "x");
        assertTrue(f.events.isEmpty());
        f.guardAllowed.set(true);
        c.damage(LIFE, null, 1, "x");
        assertEquals(1, f.guardBegins.get());
        assertEquals(1, f.guardEnds.get());
    }

    @Test
    void combatErrorsAreSwallowedAndTheGuardIsClosed() {
        CombatFamily c = new CombatFamily(f.ledger, f.host);
        f.recordThrows.set(true);
        c.damage(LIFE, null, 1, "x");
        c.playerDeath(LIFE, "x", "d");
        c.killed(LIFE, false, () -> "t");
        assertEquals(3, c.errors());
        assertEquals(f.guardBegins.get(), f.guardEnds.get());
        f.recordThrows.set(false);
        c.damage(LIFE, null, 1, "x");
        assertEquals(1, f.events.size());
    }

    // --- chat ---

    @Test
    void humanChatIsVerbatimWithNoSpeakerId() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, "HumanSteve", "minecraft:overworld", () -> "hello Steve, come to the base");
        String[] c = f.content.get(0);
        assertEquals("hello Steve, come to the base", c[0]);
        assertNull(c[1]);
        assertEquals("minecraft:overworld", c[2]);
    }

    @Test
    void lifeChatCarriesTheLifeId() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, LIFE, "w", () -> "hi");
        assertEquals(LIFE, f.content.get(0)[1]);
    }

    @Test
    void cancelledChatIsNotCaptured() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        AtomicInteger flattened = new AtomicInteger();
        t.chat(true, LIFE, "w", () -> {
            flattened.incrementAndGet();
            return "x";
        });
        assertTrue(f.content.isEmpty());
        assertEquals(0, flattened.get());
    }

    @Test
    void chatIsScrubbedAndCapped() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, LIFE, "w", () -> "the password=hunter2xyz is set");
        assertFalse(f.content.get(0)[0].contains("hunter2xyz"), f.content.get(0)[0]);
        t.chat(false, LIFE, "w", () -> "a".repeat(100_000));
        assertTrue(f.content.get(1)[0].getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 32768);
    }

    @Test
    void chatFloodDoesNoFlattenWorkAndNeverTouchesTheGuard() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        AtomicInteger flattened = new AtomicInteger();
        for (int i = 0; i < 200; i++) {
            t.chat(false, LIFE, "w", () -> {
                flattened.incrementAndGet();
                return "x";
            });
        }
        assertTrue(flattened.get() < 200, "flood must be dropped before flatten");
        assertEquals(flattened.get(), f.content.size());
        assertEquals(200 - flattened.get(), t.rateDrops());
        assertEquals(0, f.guardBegins.get());
    }

    @Test
    void chatErrorsAreDropped() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, LIFE, "w", () -> {
            throw new IllegalStateException("flatten");
        });
        f.recordThrows.set(true);
        t.chat(false, LIFE, "w", () -> "x");
        assertEquals(2, t.errors());
        assertTrue(f.content.isEmpty());
    }

    // --- operator audit ---

    @Test
    void consoleCommandIsExportedWithNamesAsTyped() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command("console", false, () -> "whitelist add HumanSteve");
        Object[] e = f.events.get(0);
        assertEquals("whitelist add HumanSteve", e[4]);
        assertEquals("console", e[5]);
    }

    @Test
    void playerAndCancelledCommandsAreNotExported() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command(OperatorAuditFamily.commandKind(true, "Server", true, false), false, () -> "home");
        a.command("console", true, () -> "stop");
        assertTrue(f.events.isEmpty());
    }

    @Test
    void authVerbArgumentsAreDropped() {
        assertEquals("login", CommandText.exportable("/Login hunter2"));
        assertEquals("execute as x run login", CommandText.exportable("execute as x run login pw123"));
        assertEquals("auth", CommandText.exportable("plugin:auth s3cret"));
        assertEquals("say hello", CommandText.exportable("say hello"));
        assertEquals("", CommandText.exportable("   "));
        assertEquals("", CommandText.exportable(null));
    }

    @Test
    void commandTextIsScrubbedAndCappedTo1KiB() {
        String scrubbed = CommandText.exportable("say password=hunter2xyz");
        assertFalse(scrubbed.contains("hunter2xyz"), scrubbed);
        assertTrue(CommandText.exportable("say " + "b".repeat(5000)).length() <= CommandText.TEXT_MAX_BYTES);
    }

    @Test
    void commandFloodDoesNoFlattenWork() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        AtomicInteger flattened = new AtomicInteger();
        for (int i = 0; i < 200; i++) {
            a.command("console", false, () -> {
                flattened.incrementAndGet();
                return "list";
            });
        }
        assertTrue(flattened.get() < 200);
        assertEquals(200 - flattened.get(), a.rateDrops());
    }

    @Test
    void asyncCommandNeverTouchesTheGuardAndErrorsAreSwallowed() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        f.main.set(false);
        a.command("console", false, () -> "list");
        assertEquals(1, f.events.size());
        assertEquals(0, f.guardBegins.get());
        f.recordThrows.set(true);
        clock.addAndGet(2_000_000_000L);
        a.command("console", false, () -> "list");
        a.command("console", false, () -> {
            throw new IllegalStateException("flatten");
        });
        assertEquals(2, a.errors());
    }

    @Test
    void mainThreadCommandUsesTheGuardAndHonoursIt() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command("console", false, () -> "list");
        assertEquals(1, f.guardBegins.get());
        assertEquals(1, f.guardEnds.get());
        f.guardAllowed.set(false);
        clock.addAndGet(2_000_000_000L);
        a.command("console", false, () -> "list");
        assertEquals(1, f.events.size());
    }

    @Test
    void operatorChangeFlagsOppedAndNamesOnlyLifeIds() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.operatorChange(LIFE, true);
        a.operatorChange("HumanSteve", false);
        assertEquals(1L, f.events.get(0)[3]);
        assertEquals(LIFE, f.events.get(0)[4]);
        assertEquals(0L, f.events.get(1)[3]);
        assertNull(f.events.get(1)[4]);
        assertTrue(f.registered.contains("geldar.operator.change"));
    }

    // --- review fixes ---

    @Test
    void commandKindExportsOnlyTrueConsoleAndRcon() {
        assertEquals("console", OperatorAuditFamily.commandKind(false, "Server", true, false));
        assertEquals("rcon", OperatorAuditFamily.commandKind(false, "Rcon", false, true));
        // a command block renamed Server or Rcon is neither the server nor an RCON source
        assertNull(OperatorAuditFamily.commandKind(false, "Server", false, false));
        assertNull(OperatorAuditFamily.commandKind(false, "Rcon", false, false));
        assertNull(OperatorAuditFamily.commandKind(false, "Server", false, true));
        assertNull(OperatorAuditFamily.commandKind(false, "Rcon", true, false));
        assertNull(OperatorAuditFamily.commandKind(true, "Server", false, false));
        assertNull(OperatorAuditFamily.commandKind(true, "Steve", false, false));
        assertNull(OperatorAuditFamily.commandKind(false, "@", false, false)); // a command block
        assertNull(OperatorAuditFamily.commandKind(false, "Steve", false, false));
        assertNull(OperatorAuditFamily.commandKind(false, null, false, false));
    }

    @Test
    void rconCommandUsesItsOwnEventAndSubtype() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command("rcon", false, () -> "list");
        a.command("console", false, () -> "list");
        assertEquals(f.registered.indexOf("geldar.rcon.command"), f.events.get(0)[0]);
        assertEquals("rcon", f.events.get(0)[5]);
        assertEquals(f.registered.indexOf("geldar.console.command"), f.events.get(1)[0]);
        assertEquals("console", f.events.get(1)[5]);
        a.command(null, false, () -> "say hi");
        assertEquals(2, f.events.size());
    }

    @Test
    void chatTextIsTheRawTypedTextOnly() {
        assertEquals("hi", TextContentFamily.chatText("hi"));
        assertEquals("", TextContentFamily.chatText(null));
        assertEquals("<Steve> hi", TextContentFamily.chatText("<Steve> hi")); // verbatim: no decoration is added or removed
    }

    @Test
    void wiringListensLastAndNeverOnCancelledEvents() throws Exception {
        java.nio.file.Path src = java.nio.file.Path.of(
                "src", "main", "java", "dev", "geldar", "ledger", "neoforge", "audit", "AuditWiring.java");
        String code = java.nio.file.Files.readString(src);
        assertTrue(code.contains("PRIORITY = EventPriority.LOWEST;"));
        assertTrue(code.contains("RECEIVE_CANCELED = false;"));
        int listeners = code.split("addListener\\(", -1).length - 1;
        int constant = code.split("addListener\\(PRIORITY, RECEIVE_CANCELED, ", -1).length - 1;
        assertEquals(5, listeners);
        assertEquals(listeners, constant);
        // the speaker name and the decorated message never enter the chat read
        assertFalse(code.contains("getUsername"));
        assertFalse(code.contains("getMessage"));
        assertTrue(code.contains("chatText(e.getRawText())"));
        assertTrue(code.contains("source.source instanceof net.minecraft.server.MinecraftServer"));
        assertTrue(code.contains("source.source instanceof net.minecraft.server.rcon.RconConsoleSource"));
    }

    @Test
    void everyAuthVerbDropsItsArguments() {
        // a fixed list, so shrinking AUTH_ROOTS cannot shrink the test
        String[] verbs = {"login", "l", "log", "register", "reg", "changepassword", "changepass", "cp", "authme", "unregister",
            "unreg", "passwd", "password", "auth", "pass", "2fa", "totp", "setpassword", "loginsecurity", "lpassword", "nlogin",
            "captcha", "email", "setemail", "changeemail", "recovery", "pin", "setpin", "secret"};
        assertEquals(verbs.length, CommandText.AUTH_ROOTS.size());
        for (String root : verbs) {
            assertEquals(root, CommandText.exportable(root + " hunter2 hunter2"), root);
            assertEquals(root, CommandText.exportable("/" + root.toUpperCase() + " hunter2"), root);
            assertEquals("execute as @a run " + root, CommandText.exportable("execute as @a run Plugin:" + root + " pw pw"));
        }
    }

    @Test
    void unicodeAndControlSeparatorsDoNotHideAnAuthVerb() {
        for (String sep : new String[] {"\u00a0", "\u2003", "\t", "\n", "\r", "\u2028", "\u3000", "\u0000"}) {
            assertEquals("login", CommandText.exportable("login" + sep + "hunter2"), "sep " + (int) sep.charAt(0));
            assertEquals("say login", CommandText.exportable("say" + sep + "login" + sep + "pw"));
        }
        assertEquals("login\u200bx", CommandText.exportable("login\u200bx")); // not whitespace: not that verb
    }

    @Test
    void hugeCommandsAreBounded() {
        assertTrue(CommandText.exportable("say " + "x".repeat(200_000)).length() <= CommandText.TEXT_MAX_BYTES);
        assertTrue(CommandText.exportable("x".repeat(150_000)).length() <= CommandText.TEXT_MAX_BYTES);
    }

    @Test
    void chatRateCapIsExactlyTwentyPerSecond() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        for (int i = 0; i < TextContentFamily.CHAT_RATE; i++) {
            t.chat(false, LIFE, "w", () -> "x");
        }
        assertEquals(20, f.content.size());
        assertEquals(0, t.rateDrops());
        t.chat(false, LIFE, "w", () -> "x");
        assertEquals(20, f.content.size());
        assertEquals(1, t.rateDrops());
        clock.addAndGet(60_000_000L);
        t.chat(false, LIFE, "w", () -> "x");
        assertEquals(21, f.content.size());
    }

    @Test
    void commandRateCapIsExactlyTwentyPerSecond() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        int console = f.registered.indexOf("geldar.console.command");
        for (int i = 0; i < 20; i++) {
            a.command("console", false, () -> "list");
        }
        assertEquals(20, f.events.stream().filter(e -> (int) e[0] == console).count());
        a.command("console", false, () -> "list");
        assertEquals(20, f.events.stream().filter(e -> (int) e[0] == console).count());
        assertEquals(1, a.rateDrops());
        clock.addAndGet(60_000_000L);
        a.command("console", false, () -> "list");
        assertEquals(21, f.events.stream().filter(e -> (int) e[0] == console).count());
    }

    @Test
    void hugeChatIsBoundedBeforeAndAfterScrub() {
        TextContentFamily t = new TextContentFamily(f.ledger, clock::get);
        t.chat(false, LIFE, "w", () -> "z".repeat(5_000_000));
        assertTrue(f.content.get(0)[0].getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 32768);
        // the marker of the final cap records the size it saw: the pre-scrub cap held it to 1 MiB
        assertTrue(f.content.get(0)[0].endsWith("[truncated:1048576]"), f.content.get(0)[0]);
    }
}
