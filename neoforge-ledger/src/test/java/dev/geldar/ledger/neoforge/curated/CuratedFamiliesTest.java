package dev.geldar.ledger.neoforge.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** Pure-logic tests for the PT-N8 families (the game-event readers in CuratedWiring need a server and are compile-only). */
class CuratedFamiliesTest {
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
        assertEquals(6, f.registered.size());
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
        c.killed(LIFE, true, "minecraft:player");
        c.killed(null, false, "minecraft:zombie");
        assertTrue(f.events.isEmpty());
        c.killed(LIFE, false, "minecraft:zombie");
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
        c.killed(LIFE, false, "t");
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
        a.command(false, false, () -> "whitelist add HumanSteve");
        Object[] e = f.events.get(0);
        assertEquals("whitelist add HumanSteve", e[4]);
        assertEquals("console", e[5]);
    }

    @Test
    void playerAndCancelledCommandsAreNotExported() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command(true, false, () -> "home");
        a.command(false, true, () -> "stop");
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
            a.command(false, false, () -> {
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
        a.command(false, false, () -> "list");
        assertEquals(1, f.events.size());
        assertEquals(0, f.guardBegins.get());
        f.recordThrows.set(true);
        clock.addAndGet(2_000_000_000L);
        a.command(false, false, () -> "list");
        a.command(false, false, () -> {
            throw new IllegalStateException("flatten");
        });
        assertEquals(2, a.errors());
    }

    @Test
    void mainThreadCommandUsesTheGuardAndHonoursIt() {
        OperatorAuditFamily a = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        a.command(false, false, () -> "list");
        assertEquals(1, f.guardBegins.get());
        assertEquals(1, f.guardEnds.get());
        f.guardAllowed.set(false);
        clock.addAndGet(2_000_000_000L);
        a.command(false, false, () -> "list");
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
        assertEquals("geldar.operator.change", f.registered.get(1));
    }
}
