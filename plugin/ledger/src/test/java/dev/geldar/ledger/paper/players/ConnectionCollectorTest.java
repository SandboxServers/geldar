package dev.geldar.ledger.paper.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.core.RecordingLedger.EventRecord;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.junit.jupiter.api.Test;

class ConnectionCollectorTest {
    static final String AGENT = "ag_ada_01";

    final AtomicLong clock = new AtomicLong(1_000_000);
    final AtomicInteger online = new AtomicInteger(1);
    final List<Listener> registered = new ArrayList<>();
    final List<String> playerCalls = new ArrayList<>();
    RecordingLedger ledger = new RecordingLedger();
    ConnectionCollector collector;
    ConnectionCollector.Handlers h;

    ConnectionCollector.Handlers start() {
        collector = new ConnectionCollector(registered::add, online::get, clock::get, new SessionIds());
        collector.start(ctx());
        h = (ConnectionCollector.Handlers) registered.get(0);
        return h;
    }

    CollectorContext ctx() {
        return new CollectorContext() {
            public dev.geldar.ledger.core.Ledger ledger() {
                return ledger;
            }

            public HostScheduler scheduler() {
                return null;
            }

            public HostInfo host() {
                return null;
            }
        };
    }

    /** A player that answers name and uuid only; any other call is recorded and fails (observe only). */
    Player player(String name, UUID id) {
        return (Player) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> {
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
                    playerCalls.add(m.getName());
                    throw new IllegalStateException("unexpected player call " + m.getName());
            }
        });
    }

    static com.destroystokyo.paper.profile.PlayerProfile profile(String name, UUID id) {
        return (com.destroystokyo.paper.profile.PlayerProfile) Proxy.newProxyInstance(
                ConnectionCollectorTest.class.getClassLoader(),
                new Class<?>[] {com.destroystokyo.paper.profile.PlayerProfile.class},
                (p, m, a) -> m.getName().equals("getName") ? name : m.getName().equals("getId") ? id : null);
    }

    static AsyncPlayerPreLoginEvent preLogin(String name, UUID id) {
        return new AsyncPlayerPreLoginEvent(name, InetAddress.getLoopbackAddress(), id, false, profile(name, id));
    }

    List<EventRecord> events(String name) {
        return ledger.events(name);
    }

    @Test
    void everyFieldPassesTheAllowList() {
        start();
        assertEquals(List.of(), ledger.rejectedEventKeys());
        assertTrue(ledger.eventFields(Names.Events.PLAYER_QUIT).contains(AttrKeys.DURATION_MS));
        assertTrue(ledger.eventFields(Names.Events.PLAYER_JOIN).contains(AttrKeys.MC_SESSION));
        assertTrue(ledger.eventFields(Names.Events.PLAYER_KICK).contains(AttrKeys.MC_SESSION));
    }

    @Test
    void joinThenQuitShareOneSessionAndQuitRecordsTheDuration() {
        start();
        UUID id = UUID.randomUUID();
        Player p = player(AGENT, id);
        online.set(3);
        h.onJoin(new PlayerJoinEvent(p, Component.text("x")));
        clock.addAndGet(65_000);
        h.onQuit(new PlayerQuitEvent(p, Component.text("x"), PlayerQuitEvent.QuitReason.TIMED_OUT));

        EventRecord join = events(Names.Events.PLAYER_JOIN).get(0);
        EventRecord quit = events(Names.Events.PLAYER_QUIT).get(0);
        assertEquals(AGENT, join.s1());
        assertEquals(26, join.s2().length());
        assertEquals(3, join.a());
        assertEquals(join.s2(), quit.s2());
        assertEquals(65_000, quit.a());
        assertEquals("TIMED_OUT", quit.s3());
        assertEquals(0, collector.sessions().size());
        assertNull(collector.sessions().get(id));
    }

    @Test
    void aSecondConnectionOfTheSamePlayerGetsAFreshSession() {
        start();
        UUID id = UUID.randomUUID();
        Player p = player(AGENT, id);
        h.onJoin(new PlayerJoinEvent(p, Component.text("x")));
        h.onQuit(new PlayerQuitEvent(p, Component.text("x"), PlayerQuitEvent.QuitReason.DISCONNECTED));
        h.onJoin(new PlayerJoinEvent(p, Component.text("x")));
        List<EventRecord> joins = events(Names.Events.PLAYER_JOIN);
        assertNotEquals(joins.get(0).s2(), joins.get(1).s2());
        assertNotEquals(id.toString(), joins.get(0).s2());
    }

    @Test
    void aNonLifeIdNameAndTheUuidAreNeverExported() {
        start();
        UUID id = UUID.randomUUID();
        String human = "SomeHuman";
        Player p = player(human, id);
        h.onJoin(new PlayerJoinEvent(p, Component.text("x")));
        h.onKick(new PlayerKickEvent(p, Component.text("bye " + human), Component.text("x"), PlayerKickEvent.Cause.PLUGIN));
        h.onQuit(new PlayerQuitEvent(p, Component.text("x"), PlayerQuitEvent.QuitReason.KICKED));
        h.onPreLogin(preLogin(human, id));
        assertFalse(ledger.allEvents().isEmpty());
        for (EventRecord r : ledger.allEvents()) {
            String all = r.s1() + "|" + r.s2() + "|" + r.s3();
            assertFalse(all.contains(human), all);
            assertFalse(all.contains(id.toString()), all);
        }
        assertEquals("", events(Names.Events.PLAYER_JOIN).get(0).s1());
        assertTrue(events(Names.Events.PLAYER_KICK).get(0).s2().contains("[player]"));
    }

    @Test
    void preLoginReadsNameAndResultButNeverAnAddress() throws Exception {
        start();
        boolean[] touched = new boolean[1];
        AsyncPlayerPreLoginEvent e = new AsyncPlayerPreLoginEvent(AGENT, InetAddress.getLoopbackAddress(), UUID.randomUUID(), false, profile(AGENT, UUID.randomUUID())) {
            @Override
            public InetAddress getAddress() {
                touched[0] = true;
                throw new IllegalStateException("address read");
            }

            @Override
            public InetAddress getRawAddress() {
                touched[0] = true;
                throw new IllegalStateException("address read");
            }
        };
        e.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, "no");
        Thread t = new Thread(() -> h.onPreLogin(e), "async-login");
        t.start();
        t.join();
        assertFalse(touched[0]);
        EventRecord r = events(Names.Events.PLAYER_PRELOGIN).get(0);
        assertEquals(AGENT, r.s1());
        assertEquals("KICK_BANNED", r.s2());
        assertEquals(0, ledger.fakeGuard(ConnectionCollector.ID).begins(), "the async handler does not time the guard");
    }

    @Test
    void kickReasonIsScrubbedAndCappedAndOverlongIsDropped() {
        start();
        Player p = player(AGENT, UUID.randomUUID());
        String ip = String.join(".", "10", "20", "30", "40");
        h.onKick(new PlayerKickEvent(p, Component.text("flying from " + ip), Component.empty(), PlayerKickEvent.Cause.FLYING_PLAYER));
        h.onKick(new PlayerKickEvent(
                p, Component.text("x".repeat(200)), Component.empty(), PlayerKickEvent.Cause.PLUGIN));
        h.onKick(new PlayerKickEvent(
                p, Component.text("x".repeat(201)), Component.empty(), PlayerKickEvent.Cause.PLUGIN));
        List<EventRecord> kicks = events(Names.Events.PLAYER_KICK);
        assertFalse(kicks.get(0).s2().contains(ip), kicks.get(0).s2());
        assertTrue(kicks.get(0).s2().startsWith("flying from"), kicks.get(0).s2());
        assertEquals(200, kicks.get(1).s2().length());
        assertEquals("", kicks.get(2).s2());
    }

    @Test
    void kickIsObservedNotChanged() {
        start();
        List<String> mutations = new ArrayList<>();
        PlayerKickEvent e = new PlayerKickEvent(
                player(AGENT, UUID.randomUUID()), Component.text("r"), Component.text("l"), PlayerKickEvent.Cause.PLUGIN) {
            @Override
            public void setCancelled(boolean cancel) {
                mutations.add("cancel");
            }

            @Override
            public void reason(Component reason) {
                mutations.add("reason");
            }

            @Override
            public void leaveMessage(Component msg) {
                mutations.add("leave");
            }
        };
        h.onKick(e);
        assertEquals(1, events(Names.Events.PLAYER_KICK).size());
        assertEquals(List.of(), mutations);
        assertEquals(List.of(), playerCalls);
    }

    @Test
    void aCancelledKickIsNotRecordedByTheRealRegistration() throws Exception {
        java.lang.reflect.Method m = ConnectionCollector.Handlers.class.getMethod("onKick", PlayerKickEvent.class);
        org.bukkit.event.EventHandler a = m.getAnnotation(org.bukkit.event.EventHandler.class);
        assertEquals(org.bukkit.event.EventPriority.MONITOR, a.priority());
        assertTrue(a.ignoreCancelled());
        for (String n : List.of("onJoin", "onQuit", "onPreLogin")) {
            for (java.lang.reflect.Method x : ConnectionCollector.Handlers.class.getMethods()) {
                if (x.getName().equals(n)) {
                    assertEquals(org.bukkit.event.EventPriority.MONITOR, x.getAnnotation(org.bukkit.event.EventHandler.class).priority());
                }
            }
        }
    }

    @Test
    void joinQuitChurnOf100kKeepsTheMapBounded() {
        start();
        int max = 0;
        for (int i = 0; i < 100_000; i++) {
            Player p = player(AGENT, new UUID(i, i));
            h.onJoin(new PlayerJoinEvent(p, Component.empty()));
            max = Math.max(max, collector.sessions().size());
            h.onQuit(new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        }
        assertEquals(1, max);
        assertEquals(0, collector.sessions().size());
    }

    @Test
    void joinsWithoutQuitsStopAtTheCap() {
        SessionIds ids = new SessionIds(50, () -> "X");
        for (int i = 0; i < 500; i++) {
            ids.open(new UUID(i, 1), 0);
        }
        assertEquals(50, ids.size());
        assertEquals(450, ids.overflowed());
        ids.open(new UUID(0, 1), 5); // a known player still re-opens at the cap
        assertEquals(50, ids.size());
    }

    @Test
    void aShutOffGuardRecordsNothingButQuitStillReleasesTheSession() {
        start();
        UUID id = UUID.randomUUID();
        Player p = player(AGENT, id);
        h.onJoin(new PlayerJoinEvent(p, Component.empty()));
        ledger.fakeGuard(ConnectionCollector.ID).disable();
        h.onQuit(new PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        h.onJoin(new PlayerJoinEvent(p, Component.empty()));
        h.onPreLogin(preLogin(AGENT, id));
        assertEquals(1, ledger.allEvents().size());
        assertEquals(0, collector.sessions().size());
    }

    @Test
    void handlersNeverThrowAndGuardEndsMatchBegins() {
        start();
        Player bad = (Player) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Player.class}, (p, m, a) -> {
            throw new IllegalStateException("boom " + m.getName());
        });
        h.onJoin(new PlayerJoinEvent(bad, Component.empty()));
        h.onQuit(new PlayerQuitEvent(bad, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED));
        h.onKick(new PlayerKickEvent(bad, Component.empty(), Component.empty(), PlayerKickEvent.Cause.PLUGIN));
        h.onJoin(null);
        h.onPreLogin(null);
        assertEquals(ledger.fakeGuard(ConnectionCollector.ID).begins(), ledger.fakeGuard(ConnectionCollector.ID).ends());
    }

    @Test
    void disabledCollectorRegistersNothingAndStopClearsSessions() {
        ledger = new RecordingLedger(null, LedgerConfig.defaults().withEnabled(false));
        collector = new ConnectionCollector(registered::add, online::get, clock::get, new SessionIds());
        collector.start(ctx());
        assertTrue(registered.isEmpty());
        assertEquals(List.of(), ledger.allEvents());

        ledger = new RecordingLedger();
        collector.start(ctx());
        ConnectionCollector.Handlers x = (ConnectionCollector.Handlers) registered.get(0);
        x.onJoin(new PlayerJoinEvent(player(AGENT, UUID.randomUUID()), Component.empty()));
        assertEquals(1, collector.sessions().size());
        collector.stop();
        collector.stop();
        assertEquals(0, collector.sessions().size());
    }

    @Test
    void sourceHasNoLoginEventAndNoAddressGetter() throws Exception {
        Path src = Path.of("src/main/java/dev/geldar/ledger/paper/players/ConnectionCollector.java");
        String text = Files.readString(src);
        assertFalse(text.contains("PlayerLoginEvent"));
        for (String banned : List.of("getAddress", "getRawAddress", "getHostAddress", "getHostname", "getRemoteAddress")) {
            assertFalse(text.contains(banned), banned);
        }
        assertFalse(Files.readString(Path.of("src/main/java/dev/geldar/ledger/paper/players/SessionIds.java"))
                .contains("PlayerLoginEvent"));
    }
}
