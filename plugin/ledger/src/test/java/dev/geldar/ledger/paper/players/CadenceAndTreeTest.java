package dev.geldar.ledger.paper.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.FakeHostScheduler;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.RecordingLedger.EventRecord;
import io.papermc.paper.event.packet.ClientTickEndEvent;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandSendEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.junit.jupiter.api.Test;

class CadenceAndTreeTest {
    final FakeHostInfo host = new FakeHostInfo();
    final RecordingLedger ledger = new RecordingLedger(host, config("true"));
    final FakeHostScheduler scheduler = new FakeHostScheduler();
    final SessionIds sessions = new SessionIds();
    final List<Listener> registered = new ArrayList<>();
    final List<Player> online = new ArrayList<>();
    final AtomicLong clock = new AtomicLong();
    ClientCadenceCollector collector;

    static LedgerConfig config(String v) {
        Properties p = new Properties();
        if (v != null) {
            p.setProperty("collector.cadence.enabled", v);
        }
        return ConfigParser.parse(p).config();
    }

    void start() {
        start(ledger);
    }

    void start(RecordingLedger led) {
        collector = new ClientCadenceCollector(registered::add, () -> List.copyOf(online), sessions, clock::get);
        collector.start(new CollectorContext() {
            public Ledger ledger() {
                return led;
            }

            public HostScheduler scheduler() {
                return scheduler;
            }

            public HostInfo host() {
                return host;
            }
        });
    }

    ClientCadenceCollector.Handlers handlers() {
        return (ClientCadenceCollector.Handlers) registered.get(0);
    }

    CommandTreeAudit audit() {
        return (CommandTreeAudit) registered.get(1);
    }

    static Player player(String name, UUID id) {
        return (Player) Proxy.newProxyInstance(CadenceAndTreeTest.class.getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "getName":
                    return name;
                case "getUniqueId":
                    return id;
                case "hashCode":
                    return id.hashCode();
                case "equals":
                    return p == a[0];
                case "toString":
                    return "player";
                default:
                    throw new IllegalStateException("unexpected player call " + m.getName());
            }
        });
    }

    void minute() {
        host.mainThread(false);
        scheduler.advanceMillis(ClientCadenceCollector.CADENCE_MS);
    }

    void join(Player p) {
        handlers().onJoin(new PlayerJoinEvent(p, Component.empty()));
    }

    static List<EventRecord> none() {
        return List.of();
    }

    @Test
    void offUnlessExplicitlyEnabled() {
        for (String v : new String[] {null, "false"}) {
            registered.clear();
            start(new RecordingLedger(host, config(v)));
            assertEquals(0, registered.size(), "listener, enabled=" + v);
            assertEquals(0, scheduler.activeTasks(), "task, enabled=" + v);
        }
        start(new RecordingLedger(host, config("true")));
        assertEquals(2, registered.size());
        assertEquals(1, scheduler.activeTasks());
    }

    @Test
    void hundredTickEventsThenTheMinuteTaskEmitsOneHundredAndResets() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        String session = sessions.open(id, 0);
        join(p);
        for (int i = 0; i < 100; i++) {
            handlers().onTickEnd(new ClientTickEndEvent(p));
        }
        assertEquals(100, collector.count(id));
        minute();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_CLIENT_TICK);
        assertEquals(1, evs.size());
        assertEquals("ag_ada_01", evs.get(0).attrs().get(AttrKeys.LIFE_ID));
        assertEquals(100L, ((Number) evs.get(0).attrs().get(AttrKeys.AMOUNT)).longValue());
        assertEquals(session, evs.get(0).attrs().get(AttrKeys.MC_SESSION));
        assertEquals(0, collector.count(id));
        minute();
        evs = ledger.events(Names.Events.PLAYER_CLIENT_TICK);
        assertEquals(2, evs.size());
        assertEquals(0L, ((Number) evs.get(1).attrs().get(AttrKeys.AMOUNT)).longValue(), "a stalled client reports zero");
        assertFalse(evs.toString().contains(id.toString()));
        assertFalse(evs.get(0).attrs().containsKey(AttrKeys.PLAYER_UUID));
    }

    @Test
    void aHumanHasNoSlotAndNoEvent() {
        start();
        UUID id = new UUID(0, 2);
        Player human = player("Steve", id);
        join(human);
        handlers().onTickEnd(new ClientTickEndEvent(human));
        assertEquals(-1, collector.count(id));
        minute();
        assertEquals(0, ledger.events(Names.Events.PLAYER_CLIENT_TICK).size());
        audit().onCommandSend(new PlayerCommandSendEvent(human, new ArrayList<>(List.of("a"))));
        assertEquals(0, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
    }

    @Test
    void agentsAlreadyOnlineAtStartAreCountedAndAQuitFreesTheSlot() {
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        online.add(p);
        start();
        handlers().onTickEnd(new ClientTickEndEvent(p));
        assertEquals(1, collector.count(id));
        handlers().onQuit(new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        assertEquals(-1, collector.count(id));
        minute();
        assertEquals(1, ledger.events(Names.Events.PLAYER_CLIENT_TICK).size(), "only the final window of the quit connection");
    }

    @Test
    void theEmitTaskNeverRunsOnTheMainThread() {
        start();
        join(player("ag_ada_01", new UUID(0, 1)));
        host.mainThread(true);
        scheduler.advanceMillis(ClientCadenceCollector.CADENCE_MS);
        assertEquals(0, ledger.events(Names.Events.PLAYER_CLIENT_TICK).size());
        assertTrue(ledger.mainThreadViolations().isEmpty());
    }

    @Test
    void slotsAreBoundedAndAFreedSlotIsReused() {
        start();
        Player firstPlayer = null;
        for (int i = 0; i < ClientCadenceCollector.MAX_SLOTS; i++) {
            Player pl = player("ag_ada_" + (i + 10), new UUID(0, i + 1));
            if (i == 0) {
                firstPlayer = pl;
            }
            join(pl);
        }
        UUID extra = new UUID(0, 9999);
        Player extraPlayer = player("ag_extra_11", extra);
        join(extraPlayer);
        assertEquals(-1, collector.count(extra));
        handlers().onQuit(new PlayerQuitEvent(firstPlayer, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        join(extraPlayer);
        assertEquals(0, collector.count(extra));
    }

    @Test
    void aBadEventNeverEscapesAHandler() {
        start();
        handlers().onTickEnd(new ClientTickEndEvent(null));
        handlers().onJoin(new PlayerJoinEvent(null, Component.empty()));
        handlers().onQuit(new PlayerQuitEvent(null, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        audit().onCommandSend(new PlayerCommandSendEvent(null, new ArrayList<>()));
        assertEquals(0, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
    }

    @Test
    void stopCancelsTheTaskAndForgetsEveryone() {
        UUID id = new UUID(0, 1);
        online.add(player("ag_ada_01", id));
        start();
        assertEquals(0, collector.count(id));
        collector.stop();
        assertEquals(0, scheduler.activeTasks());
        assertEquals(-1, collector.count(id));
    }

    @Test
    void theCommandTreeRecordsSizeAndHashAndNeverTheNames() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        String session = sessions.open(id, 0);
        join(p);
        List<String> cmds = new ArrayList<>(List.of("zeta_secret", "alpha_secret", "op"));
        audit().onCommandSend(new PlayerCommandSendEvent(p, cmds));
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_COMMAND_TREE);
        assertEquals(1, evs.size());
        EventRecord r = evs.get(0);
        assertEquals("ag_ada_01", r.s1());
        assertEquals(session, r.s2());
        assertEquals(3L, r.a());
        assertEquals(String.format("%08x", Arrays.hashCode(new String[] {"alpha_secret", "op", "zeta_secret"})), r.s3());
        String all = evs.toString();
        assertFalse(all.contains("secret") || all.contains("op,") || all.contains(id.toString()), all);
        assertEquals(List.of("zeta_secret", "alpha_secret", "op"), cmds, "the tree the player sees is untouched");
    }

    @Test
    void theHashIgnoresOrderAndSeparatesDifferentTrees() {
        assertEquals(CommandTreeAudit.hash(new String[] {"b", "a"}), CommandTreeAudit.hash(new String[] {"a", "b"}));
        assertNotEquals(CommandTreeAudit.hash(new String[] {"a", "b"}), CommandTreeAudit.hash(new String[] {"a", "c"}));
        String[] in = {"b", "a"};
        CommandTreeAudit.hash(in);
        assertEquals("b", in[0], "the caller's array is not sorted in place");
    }


    /** A command collection that counts how often its names are copied out (the start of the sort). */
    static final class CountingCommands extends ArrayList<String> {
        private static final long serialVersionUID = 1L;
        int copies;

        CountingCommands(String... names) {
            super(List.of(names));
        }

        @Override
        public <T> T[] toArray(T[] a) {
            copies++;
            return super.toArray(a);
        }
    }

    static PlayerQuitEvent quit(Player p) {
        return new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED);
    }

    static long amount(EventRecord r) {
        return ((Number) r.attrs().get(AttrKeys.AMOUNT)).longValue();
    }

    static long duration(EventRecord r) {
        return ((Number) r.attrs().get(AttrKeys.DURATION_MS)).longValue();
    }

    @Test
    void theTreeIsRecordedOncePerConnectionAndAgainAfterARejoin() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        sessions.open(id, 0);
        join(p);
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a", "b"))));
        assertEquals(1, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
        handlers().onQuit(quit(p));
        sessions.open(id, 0);
        join(p);
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a", "b"))));
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_COMMAND_TREE);
        assertEquals(2, evs.size());
        assertEquals(2L, evs.get(1).a());
    }

    @Test
    void aTreeSentBeforeTheSessionExistsIsHeldAndRecordedWithTheSessionAtJoin() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a", "b"))));
        assertEquals(0, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size(), "no session yet: held");
        String session = sessions.open(id, 0);
        join(p);
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_COMMAND_TREE);
        assertEquals(1, evs.size());
        assertEquals(session, evs.get(0).s2());
        assertEquals(2L, evs.get(0).a());
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        join(p);
        minute();
        assertEquals(1, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size(), "one per connection, flushed once");
    }

    @Test
    void aHeldTreeIsFlushedByTheFirstTickEndOnceTheSessionExists() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        handlers().onTickEnd(new ClientTickEndEvent(p));
        assertEquals(0, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
        String session = sessions.open(id, 0);
        handlers().onTickEnd(new ClientTickEndEvent(p));
        assertEquals(session, ledger.events(Names.Events.PLAYER_COMMAND_TREE).get(0).s2());
    }

    @Test
    void aHeldTreeWithNoSessionIsStillRecordedByTheMinuteTaskAndADepartedOneIsDropped() {
        start();
        Player p = player("ag_ada_01", new UUID(0, 1));
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        minute();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_COMMAND_TREE);
        assertEquals(1, evs.size());
        assertEquals("", evs.get(0).s2());
        Player q = player("ag_bob_02", new UUID(0, 2));
        audit().onCommandSend(new PlayerCommandSendEvent(q, new ArrayList<>(List.of("a"))));
        handlers().onQuit(quit(q));
        sessions.open(new UUID(0, 2), 0);
        join(q);
        minute();
        assertEquals(1, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size(), "the held tree died with its connection");
    }

    @Test
    void aStaleQuitDoesNotFreeTheSlotOfTheReconnectedAgent() {
        start();
        UUID id = new UUID(0, 1);
        Player oldConn = player("ag_ada_01", id);
        Player newConn = player("ag_ada_01", id);
        join(oldConn);
        join(newConn);
        handlers().onQuit(quit(oldConn));
        assertEquals(0, collector.count(id), "the new connection keeps its slot");
        handlers().onTickEnd(new ClientTickEndEvent(newConn));
        assertEquals(1, collector.count(id));
        handlers().onQuit(quit(newConn));
        assertEquals(-1, collector.count(id));
    }

    @Test
    void aTickEndOfAnAgentWithoutASlotClaimsOne() {
        start();
        Player p = player("ag_ada_01", new UUID(0, 1));
        handlers().onTickEnd(new ClientTickEndEvent(p));
        assertEquals(1, collector.count(new UUID(0, 1)));
        Player human = player("Steve", new UUID(0, 2));
        handlers().onTickEnd(new ClientTickEndEvent(human));
        assertEquals(-1, collector.count(new UUID(0, 2)));
    }

    @Test
    void agentsBeyondTheSlotLimitAreCountedOnceEachAndNeverBreakTheOthers() {
        start();
        for (int i = 0; i < ClientCadenceCollector.MAX_SLOTS; i++) {
            join(player("ag_ada_" + (i + 10), new UUID(0, i + 1)));
        }
        Player extra = player("ag_extra_11", new UUID(0, 9999));
        join(extra);
        handlers().onTickEnd(new ClientTickEndEvent(extra));
        handlers().onTickEnd(new ClientTickEndEvent(extra));
        assertEquals(1, collector.overflowed());
        assertEquals(-1, collector.count(new UUID(0, 9999)));
        handlers().onQuit(quit(extra));
        join(extra);
        assertEquals(2, collector.overflowed(), "a reconnect after a quit is counted again");
    }

    @Test
    void theClientTickEventCarriesTheWindowLength() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        join(p);
        clock.addAndGet(60_000_000_000L);
        minute();
        clock.addAndGet(5_000_000_000L);
        minute();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_CLIENT_TICK);
        assertEquals(60_000L, duration(evs.get(0)));
        assertEquals(5_000L, duration(evs.get(1)));
    }

    @Test
    void aDepartingAgentsFinalPartialWindowIsEmittedByTheNextTask() {
        start();
        UUID id = new UUID(0, 1);
        Player p = player("ag_ada_01", id);
        String session = sessions.open(id, 0);
        join(p);
        for (int i = 0; i < 7; i++) {
            handlers().onTickEnd(new ClientTickEndEvent(p));
        }
        clock.addAndGet(30_000_000_000L);
        sessions.close(id);
        handlers().onQuit(quit(p));
        minute();
        List<EventRecord> evs = ledger.events(Names.Events.PLAYER_CLIENT_TICK);
        assertEquals(1, evs.size());
        assertEquals(7L, amount(evs.get(0)));
        assertEquals(30_000L, duration(evs.get(0)));
        assertEquals("ag_ada_01", evs.get(0).attrs().get(AttrKeys.LIFE_ID));
        assertEquals(session, evs.get(0).attrs().get(AttrKeys.MC_SESSION));
        minute();
        assertEquals(1, ledger.events(Names.Events.PLAYER_CLIENT_TICK).size(), "emitted once");
    }

    @Test
    void aReconnectEmitsTheOldConnectionsWindowAndTheNewOneSeparately() {
        start();
        UUID id = new UUID(0, 1);
        Player oldConn = player("ag_ada_01", id);
        Player newConn = player("ag_ada_01", id);
        join(oldConn);
        handlers().onTickEnd(new ClientTickEndEvent(oldConn));
        join(newConn);
        handlers().onTickEnd(new ClientTickEndEvent(newConn));
        handlers().onTickEnd(new ClientTickEndEvent(newConn));
        minute();
        List<Long> amounts = ledger.events(Names.Events.PLAYER_CLIENT_TICK).stream().map(CadenceAndTreeTest::amount).sorted().toList();
        assertEquals(List.of(1L, 2L), amounts);
    }

    @Test
    void theEmitTaskDoesNothingWhileTheGuardIsDisabled() {
        start();
        Player p = player("ag_ada_01", new UUID(0, 1));
        join(p);
        ledger.fakeGuard(ClientCadenceCollector.ID).disable();
        minute();
        assertEquals(0, ledger.events(Names.Events.PLAYER_CLIENT_TICK).size());
    }

    @Test
    void theNamesAreNotCopiedOrSortedForAHumanAnAlreadyAuditedConnectionOrACappedEvent() {
        start();
        CountingCommands forHuman = new CountingCommands("a");
        audit().onCommandSend(new PlayerCommandSendEvent(player("Steve", new UUID(0, 2)), forHuman));
        assertEquals(0, forHuman.copies);
        Player p = player("ag_ada_01", new UUID(0, 1));
        sessions.open(new UUID(0, 1), 0);
        CountingCommands first = new CountingCommands("a");
        audit().onCommandSend(new PlayerCommandSendEvent(p, first));
        assertEquals(1, first.copies);
        CountingCommands again = new CountingCommands("a");
        audit().onCommandSend(new PlayerCommandSendEvent(p, again));
        assertEquals(0, again.copies, "already audited");
        for (int i = 0; i < CommandTreeAudit.PER_SECOND; i++) {
            UUID u = new UUID(0, 100 + i);
            sessions.open(u, 0);
            audit().onCommandSend(new PlayerCommandSendEvent(player("ag_cap_" + (i + 10), u), new CountingCommands("a")));
        }
        CountingCommands capped = new CountingCommands("a");
        audit().onCommandSend(new PlayerCommandSendEvent(player("ag_late_55", new UUID(0, 500)), capped));
        assertEquals(0, capped.copies, "over the cap: no copy, no sort");
    }

    @Test
    void theTreeIsCappedPerSecondBeforeAnyWorkAndTheLastAllowedPassesThenTheWindowReopens() {
        start();
        int n = CommandTreeAudit.PER_SECOND + 5;
        Player last = null;
        for (int i = 0; i < n; i++) {
            Player p = player("ag_ada_" + (i + 10), new UUID(0, i + 1));
            sessions.open(new UUID(0, i + 1), 0);
            last = p;
            audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        }
        assertEquals(CommandTreeAudit.PER_SECOND, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
        clock.addAndGet(1_000_000_000L);
        audit().onCommandSend(new PlayerCommandSendEvent(last, new ArrayList<>(List.of("a"))));
        assertEquals(CommandTreeAudit.PER_SECOND + 1, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
    }

    @Test
    void repeatTreesOfAnAuditedConnectionDoNotUseUpTheCap() {
        start();
        Player p = player("ag_ada_01", new UUID(0, 1));
        sessions.open(new UUID(0, 1), 0);
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        for (int i = 0; i < 3 * CommandTreeAudit.PER_SECOND; i++) {
            audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        }
        Player q = player("ag_bob_02", new UUID(0, 2));
        sessions.open(new UUID(0, 2), 0);
        audit().onCommandSend(new PlayerCommandSendEvent(q, new ArrayList<>(List.of("a"))));
        assertEquals(2, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
    }

    @Test
    void aHugeTreeIsCountedButNotHashed() {
        start();
        List<String> big = new ArrayList<>();
        for (int i = 0; i <= CommandTreeAudit.MAX_COMMANDS; i++) {
            big.add("c" + i);
        }
        sessions.open(new UUID(0, 1), 0);
        audit().onCommandSend(new PlayerCommandSendEvent(player("ag_ada_01", new UUID(0, 1)), big));
        EventRecord r = ledger.events(Names.Events.PLAYER_COMMAND_TREE).get(0);
        assertEquals(CommandTreeAudit.MAX_COMMANDS + 1L, r.a());
        assertEquals("", r.s3());
    }

    @Test
    void aDisabledGuardRecordsNothing() {
        start();
        Player p = player("ag_ada_01", new UUID(0, 1));
        join(p);
        ledger.fakeGuard(ClientCadenceCollector.ID).disable();
        handlers().onTickEnd(new ClientTickEndEvent(p));
        audit().onCommandSend(new PlayerCommandSendEvent(p, new ArrayList<>(List.of("a"))));
        assertEquals(0, collector.count(new UUID(0, 1)));
        assertEquals(0, ledger.events(Names.Events.PLAYER_COMMAND_TREE).size());
    }
}