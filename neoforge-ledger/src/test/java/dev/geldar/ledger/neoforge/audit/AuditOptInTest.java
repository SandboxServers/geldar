package dev.geldar.ledger.neoforge.audit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The audit opt-in (collector.audit.enabled, default off) on every thread, and the rate.* config for chat and commands. */
class AuditOptInTest {
    final FakeLedger f = new FakeLedger();
    final AtomicLong clock = new AtomicLong(1_000_000_000L);
    final AtomicInteger reads = new AtomicInteger();

    private static final String LIFE = "ag_ada_01";

    /** Drives every audit path once, on the current thread setting; returns nothing, the fake records it all. */
    private void driveAll() {
        CombatFamily combat = new CombatFamily(f.ledger, f.host);
        TextContentFamily text = f.text(clock::get);
        OperatorAuditFamily op = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        combat.damage(LIFE, null, 2, "mob");
        combat.playerDeath(LIFE, "mob", "w");
        combat.killed(LIFE, false, () -> {
            reads.incrementAndGet();
            return "zombie";
        });
        text.chat(false, LIFE, "w", () -> {
            reads.incrementAndGet();
            return "hello";
        });
        op.command("console", false, () -> {
            reads.incrementAndGet();
            return "list";
        });
        op.command("rcon", false, () -> {
            reads.incrementAndGet();
            return "list";
        });
        op.operatorChange(LIFE, true);
    }

    private void assertNothingExported(String why) {
        assertTrue(f.events.isEmpty(), why + ": events " + f.events.size());
        assertTrue(f.content.isEmpty(), why + ": content");
        assertEquals(0, reads.get(), why + ": reads");
        assertEquals(0, f.guardBegins.get(), why + ": guard");
    }

    @Test
    void offByDefaultOnEveryThread() {
        for (boolean main : new boolean[] {true, false}) {
            for (String[] cfg : new String[][] {
                {}, {"collector.audit.enabled=false"}, {"enabled=false", "collector.audit.enabled=true"}
            }) {
                f.config = FakeLedger.config(cfg);
                f.main.set(main);
                driveAll();
                assertNothingExported("main=" + main + " cfg=" + String.join(",", cfg));
            }
        }
    }

    @Test
    void installsNothingUnlessAuditIsExplicitlyOn() {
        assertFalse(AuditWiring.shouldInstall(null));
        for (String[] cfg : new String[][] {
            {}, {"collector.audit.enabled=false"}, {"enabled=false", "collector.audit.enabled=true"}
        }) {
            f.config = FakeLedger.config(cfg);
            assertFalse(AuditWiring.shouldInstall(f.ledger), String.join(",", cfg));
        }
        f.config = FakeLedger.config("collector.audit.enabled=true");
        assertTrue(AuditWiring.shouldInstall(f.ledger));
    }

    @Test
    void onWhenExplicitlyEnabled() {
        driveAll();
        assertEquals(6, f.events.size());
        assertEquals(1, f.content.size());
        assertFalse(f.events.isEmpty());
    }

    @Test
    void turningTheKeyOffAtRuntimeStopsAFamilyAlreadyBuilt() {
        TextContentFamily text = f.text(clock::get);
        text.chat(false, LIFE, "w", () -> "a");
        assertEquals(1, f.content.size());
        f.config = FakeLedger.config("collector.audit.enabled=false");
        text.chat(false, LIFE, "w", () -> {
            reads.incrementAndGet();
            return "b";
        });
        assertEquals(1, f.content.size());
        assertEquals(0, reads.get());
    }

    @Test
    void operatorSwitchStopsOffThreadRconAndOpChangeButNotChat() {
        f.config = FakeLedger.config("collector.audit.enabled=true", "collector.chat.enabled=true", "collector.operator.enabled=false");
        f.main.set(false); // RCON and chat arrive off the server thread
        OperatorAuditFamily op = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        TextContentFamily text = f.text(clock::get);
        op.command("rcon", false, () -> {
            reads.incrementAndGet();
            return "stop";
        });
        op.operatorChange(LIFE, true);
        assertTrue(f.events.isEmpty());
        assertEquals(0, reads.get());
        text.chat(false, LIFE, "w", () -> "still on");
        assertEquals(1, f.content.size());
    }

    @Test
    void combatSwitchStopsCombat() {
        f.config = FakeLedger.config("collector.audit.enabled=true", "collector.combat.enabled=false");
        CombatFamily combat = new CombatFamily(f.ledger, f.host);
        combat.damage(LIFE, null, 2, "mob");
        assertTrue(f.events.isEmpty());
    }

    // --- chat has its own switch (collector.chat.enabled, default off, owner decision D-F pending) ---

    private void assertNoChat(String why) {
        f.main.set(false);
        reads.set(0);
        int before = f.content.size();
        var swapped = f.config; // a malformed value may leave no config at all: build the family on a good one first
        f.config = FakeLedger.config("collector.audit.enabled=true", "collector.chat.enabled=true");
        TextContentFamily family = f.text(clock::get);
        f.config = swapped;
        family.chat(false, LIFE, "w", () -> {
            reads.incrementAndGet();
            return "hello";
        });
        assertEquals(before, f.content.size(), why + ": content");
        assertEquals(0, reads.get(), why + ": text read");
        assertFalse(AuditWiring.shouldInstallChat(f.ledger), why + ": install");
    }

    @Test
    void chatIsOffByDefaultEvenWithAuditOn() {
        for (String[] cfg : new String[][] {
            {"collector.audit.enabled=true"},
            {"collector.audit.enabled=true", "collector.chat.enabled=false"},
            {"collector.audit.enabled=true", "collector.chat.enabled=yes"},
            {"collector.audit.enabled=true", "collector.chat.enabled="},
        }) {
            f.config = FakeLedger.config(cfg);
            assertNoChat(String.join(",", cfg));
        }
        // the other audit families keep working under their own flags
        f.config = FakeLedger.config("collector.audit.enabled=true");
        f.main.set(true);
        driveAll();
        assertEquals(6, f.events.size());
        assertTrue(f.content.isEmpty());
    }

    @Test
    void chatIsOnOnlyWithAuditAndChatBothOnAndTheMasterOn() {
        f.config = FakeLedger.config("collector.audit.enabled=true", "collector.chat.enabled=true");
        assertTrue(AuditWiring.shouldInstallChat(f.ledger));
        for (boolean main : new boolean[] {true, false}) {
            f.main.set(main);
            f.text(clock::get).chat(false, LIFE, "w", () -> "hi");
        }
        assertEquals(2, f.content.size());
        for (String[] cfg : new String[][] {
            {"collector.chat.enabled=true"},
            {"collector.audit.enabled=false", "collector.chat.enabled=true"},
            {"enabled=false", "collector.audit.enabled=true", "collector.chat.enabled=true"},
        }) {
            f.config = FakeLedger.config(cfg);
            assertNoChat(String.join(",", cfg));
        }
    }

    @Test
    void turningChatOffAtRuntimeStopsAFamilyAlreadyBuilt() {
        TextContentFamily text = f.text(clock::get);
        f.main.set(false);
        text.chat(false, LIFE, "w", () -> "a");
        assertEquals(1, f.content.size());
        f.config = FakeLedger.config("collector.audit.enabled=true");
        text.chat(false, LIFE, "w", () -> {
            reads.incrementAndGet();
            return "b";
        });
        assertEquals(1, f.content.size());
        assertEquals(0, reads.get());
    }

    // --- rate.<event> ---

    private int dropId(String name) {
        return f.registered.indexOf(name + "._rate_drop");
    }

    private long dropRecords(String name) {
        int id = dropId(name);
        return f.events.stream().filter(e -> (int) e[0] == id).count();
    }

    @Test
    void chatHonoursTheConfiguredRateAndCountsEveryDrop() {
        f.config = FakeLedger.config("collector.audit.enabled=true", "collector.chat.enabled=true", "rate.geldar.chat=100");
        TextContentFamily t = f.text(clock::get);
        assertEquals(0, f.registeredRates.get("geldar.chat._rate_drop"));
        for (int i = 0; i < 150; i++) {
            t.chat(false, LIFE, "w", () -> "x");
        }
        assertTrue(f.content.size() > 20, "the raised rate applies: " + f.content.size());
        assertEquals(150, f.content.size() + dropRecords("geldar.chat"));
        assertEquals(dropRecords("geldar.chat"), t.rateDrops());
    }

    @Test
    void chatDefaultRateStaysTwentyAndFloodIsCounted() {
        TextContentFamily t = f.text(clock::get);
        for (int i = 0; i < 200; i++) {
            t.chat(false, LIFE, "w", () -> "x");
        }
        assertTrue(f.content.size() <= 20);
        assertEquals(200 - f.content.size(), dropRecords("geldar.chat"));
    }

    @Test
    void commandsHonourTheirOwnConfiguredRatesAndCountDrops() {
        f.config = FakeLedger.config("collector.audit.enabled=true", "rate.geldar.console.command=100");
        OperatorAuditFamily op = new OperatorAuditFamily(f.ledger, f.host, clock::get);
        for (int i = 0; i < 150; i++) {
            op.command("console", false, () -> "list");
        }
        for (int i = 0; i < 150; i++) {
            op.command("rcon", false, () -> "list"); // rcon keeps the default 20, its bucket is separate
        }
        long console = f.events.stream().filter(e -> (int) e[0] == f.registered.indexOf("geldar.console.command")).count();
        long rcon = f.events.stream().filter(e -> (int) e[0] == f.registered.indexOf("geldar.rcon.command")).count();
        assertTrue(console > 20, "console rate raised: " + console);
        assertTrue(rcon <= 20, "rcon default: " + rcon);
        assertEquals(150, console + dropRecords("geldar.console.command"));
        assertEquals(150, rcon + dropRecords("geldar.rcon.command"));
    }
}
