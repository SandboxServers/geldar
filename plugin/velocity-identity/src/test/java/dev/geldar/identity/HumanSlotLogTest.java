package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.proxy.Player;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.Logger;

/**
 * The human slot count lines: one INFO line when a slot is reserved and one when it is released, each with the slots held
 * after it. A WARN appears only when an admitted human's disconnect finds its slot already gone. Counts only: no name, UUID
 * or IP is ever logged on these lines.
 */
class HumanSlotLogTest {
    private static final DisconnectEvent.LoginStatus CLEAN = DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN;
    private static final int CAP = HumanSlots.SHARD_MAX_PLAYERS;
    private static final String NO_SLOT_WARN = "warn human slot release found no slot []";

    /** The line a reservation logs once {@code held} slots are held: its level, its format and its arguments. */
    private static String reserved(int held) {
        return "info human slot reserved: {}/{} [" + held + ", " + CAP + "]";
    }

    /** The line a release logs once {@code held} slots are held. */
    private static String released(int held) {
        return "info human slot released: {}/{} [" + held + ", " + CAP + "]";
    }

    /** A synced plugin on the human lane that logs into {@code lines}. */
    private static IdentityPluginFixture humanProxy(Path dir, List<String> lines) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true, recordingLog(lines));
        fixture.init();
        fixture.syncRegistry();
        return fixture;
    }

    /** The slot lines only. The admission and denial lines name the player and are not the subject of these tests. */
    private static List<String> slotLines(List<String> lines) {
        return lines.stream().filter(line -> line.contains("human slot")).collect(Collectors.toList());
    }

    /** A logger that keeps each line as its level, format and arguments, so a test can read exactly what was logged. */
    private static Logger recordingLog(List<String> lines) {
        return (Logger) Proxy.newProxyInstance(Logger.class.getClassLoader(), new Class<?>[] {Logger.class}, (p, m, a) -> {
            String level = m.getName();
            if (("info".equals(level) || "warn".equals(level) || "error".equals(level)) && a != null && a.length > 0) {
                lines.add(level + " " + a[0] + " " + Arrays.deepToString(Arrays.copyOfRange(a, 1, a.length)));
            }
            return m.getReturnType() == boolean.class ? Boolean.FALSE : null;
        });
    }

    @Test
    void aHumanLoginLogsOneReserveLineWithCountsOnly(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        String name = "Human0";
        UUID id = UUID.randomUUID();
        assertTrue(fixture.loginAllowed(name, id));
        assertEquals(List.of(reserved(1)), slotLines(lines));
        for (String line : slotLines(lines)) {
            assertFalse(line.contains(name), line);
            assertFalse(line.contains(id.toString()), line);
        }
    }

    @Test
    void aHumanDisconnectLogsOneReleaseLineAndNothingElse(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        UUID id = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", id));
        lines.clear();
        fixture.disconnect(id, CLEAN);
        assertEquals(List.of(released(0)), lines);
        assertFalse(lines.get(0).contains(id.toString()), "no UUID in the release line");
    }

    @Test
    void twoHumansCountUpAndTheLeaverCountsDown(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        UUID first = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", first));
        assertTrue(fixture.loginAllowed("Human1", UUID.randomUUID()));
        assertEquals(List.of(reserved(1), reserved(2)), slotLines(lines));
        lines.clear();
        fixture.disconnect(first, CLEAN);
        assertEquals(List.of(released(1)), lines);
    }

    @Test
    void aLoginRefusedForItsNameLogsNoReserveReleaseOrWarn(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        lines.clear();
        Player player = fixture.newPlayer("ag_alice_01", UUID.randomUUID());
        LoginEvent event = fixture.login(player);
        assertFalse(fixture.allowed(event));
        fixture.settle(event);
        fixture.disconnect(player, CLEAN);
        assertEquals(List.of("info Denied {} [ag_alice_01]"), lines, "only the ordinary denial line");
    }

    @Test
    void aLoginRefusedByAnUnsyncedRegistryLogsNoSlotLineAndItsDisconnectNoWarn(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        fixture.unsyncRegistry();
        Player player = fixture.newPlayer("Human0", UUID.randomUUID());
        LoginEvent event = fixture.login(player);
        assertFalse(fixture.allowed(event));
        fixture.settle(event);
        fixture.disconnect(player, CLEAN);
        assertTrue(slotLines(lines).isEmpty(), lines.toString());
        assertTrue(lines.stream().noneMatch(line -> line.startsWith("warn")), lines.toString());
    }

    @Test
    void anAgentLaneConnectionLogsNoSlotLines(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "agent", true, recordingLog(lines));
        fixture.init();
        fixture.syncRegistry();
        fixture.register("alice");
        UUID id = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("alice", id), "the agent is admitted without a slot");
        fixture.disconnect(id, CLEAN);
        assertTrue(slotLines(lines).isEmpty(), lines.toString());
    }

    @Test
    void aDuplicateOfAHeldUuidLogsNoReserveAndItsDisconnectNoReleaseOrWarn(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        UUID shared = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", shared));
        lines.clear();
        Player duplicate = fixture.newPlayer("Human0", shared);
        LoginEvent event = fixture.login(duplicate);
        assertFalse(fixture.allowed(event));
        fixture.settle(event);
        fixture.disconnect(duplicate, CLEAN);
        assertEquals(List.of("info Denied {} [Human0]"), lines, "the holder's slot is neither logged nor freed");
    }

    /** A human the settle step gives back is released once, logged once, and its later disconnect is silent. */
    @Test
    void aHumanRefusedAfterItsReservationLogsOneReleaseAndNoWarnOnDisconnect(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        Player player = fixture.newPlayer("Human0", UUID.randomUUID());
        LoginEvent event = fixture.login(player);
        assertTrue(fixture.allowed(event));
        event.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        fixture.settle(event);
        assertEquals(List.of(reserved(1), released(0)), slotLines(lines));
        lines.clear();
        fixture.disconnect(player, CLEAN);
        assertEquals(List.of(), lines);
    }

    /** The one case that warns: an admitted human whose slot was given back before its disconnect. */
    @Test
    void aHumanWhoseSlotIsGoneAtDisconnectWarnsOnce(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        Player player = fixture.newPlayer("Human0", UUID.randomUUID());
        assertTrue(fixture.allowed(fixture.login(player)));
        fixture.releaseSlotBehindThePlugin(player);
        lines.clear();
        fixture.disconnect(player, CLEAN);
        assertEquals(List.of(NO_SLOT_WARN), lines);
    }

    /** The cap boundary with the logging in place: the 100th reservation logs 100/100, the 101st logs no reserve line. */
    @Test
    void theHundredthHumanLogsTheFullCountAndTheHundredFirstIsRefusedWithNoReserveLine(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = humanProxy(dir, lines);
        List<UUID> ids = new ArrayList<>();
        List<String> expected = new ArrayList<>();
        for (int held = 1; held <= CAP; held++) {
            UUID id = UUID.randomUUID();
            ids.add(id);
            assertTrue(fixture.loginAllowed("Human" + held, id), "login " + held);
            expected.add(reserved(held));
        }
        assertEquals(expected, reserveLines(lines));
        assertEquals(reserved(CAP), reserveLines(lines).get(CAP - 1));
        lines.clear();
        assertFalse(fixture.loginAllowed("Human" + (CAP + 1), UUID.randomUUID()));
        assertTrue(reserveLines(lines).isEmpty(), lines.toString());
        assertTrue(lines.stream().noneMatch(line -> line.contains("human slot released")), lines.toString());
        lines.clear();
        fixture.disconnect(ids.get(0), CLEAN);
        assertEquals(List.of(released(CAP - 1)), lines);
    }

    /** A broken slot logger changes no decision: the reservation, the duplicate refusal, the cap and the release all hold. */
    @Test
    void aFailingSlotLoggerNeverRefusesAReservationOrChangesTheCount(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = failingProxy(dir, lines);
        List<UUID> ids = new ArrayList<>();
        for (int held = 1; held <= CAP; held++) {
            UUID id = UUID.randomUUID();
            ids.add(id);
            assertTrue(fixture.loginAllowed("Human" + held, id), "login " + held);
        }
        assertFalse(fixture.loginAllowed("Human" + (CAP + 1), UUID.randomUUID()), "the cap still holds");
        assertFalse(fixture.loginAllowed("Human1", ids.get(0)), "the holder's slot is still held");
        assertDoesNotThrow(() -> fixture.disconnect(ids.get(0), CLEAN));
        assertTrue(fixture.loginAllowed("Human" + (CAP + 1), UUID.randomUUID()), "the freed slot admits the next human");
        assertFalse(fixture.loginAllowed("Human" + (CAP + 2), UUID.randomUUID()), "and the count is full again");
    }

    /** A broken slot logger cannot stop the settle release: the UUID that was refused gets its slot back. */
    @Test
    void aFailingSlotLoggerNeverBreaksTheSettleRelease(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = failingProxy(dir, lines);
        UUID id = UUID.randomUUID();
        LoginEvent event = fixture.login(fixture.newPlayer("Human0", id));
        assertTrue(fixture.allowed(event));
        event.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        assertDoesNotThrow(() -> fixture.settle(event));
        assertTrue(fixture.loginAllowed("Human0", id), "the settle release freed the slot, so the UUID is not TAKEN");
        assertDoesNotThrow(() -> fixture.disconnect(id, CLEAN));
    }

    /**
     * An Error from the slot logger is not a RuntimeException. It must not refuse a reservation, must not leave the count
     * wrong, and must not stop a release or the next login.
     */
    @Test
    void anErrorFromTheSlotLoggerNeverStopsAReservationOrARelease(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = errorProxy(dir, lines);
        List<UUID> ids = new ArrayList<>();
        for (int held = 1; held <= CAP; held++) {
            UUID id = UUID.randomUUID();
            ids.add(id);
            assertTrue(fixture.loginAllowed("Human" + held, id), "login " + held);
        }
        assertFalse(fixture.loginAllowed("Human" + (CAP + 1), UUID.randomUUID()), "the count is exact: the cap still holds");
        assertDoesNotThrow(() -> fixture.disconnect(ids.get(0), CLEAN));
        assertTrue(fixture.loginAllowed("Human" + (CAP + 1), UUID.randomUUID()), "the freed slot admits the next human");
        assertFalse(fixture.loginAllowed("Human" + (CAP + 2), UUID.randomUUID()), "and the count is full again");
    }

    /**
     * The disconnect warns, and the warning's logger throws. The handler must still return normally, and the count must
     * stay exact: after the warned disconnect the cap admits one more human and then refuses.
     */
    @Test
    void aThrowingWarnAtDisconnectNeverStopsTheDisconnect(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = failingProxy(dir, lines);
        List<Player> players = new ArrayList<>();
        for (int held = 1; held <= CAP; held++) {
            Player player = fixture.newPlayer("Human" + held, UUID.randomUUID());
            players.add(player);
            assertTrue(fixture.allowed(fixture.login(player)), "login " + held);
        }
        fixture.releaseSlotBehindThePlugin(players.get(0));
        assertDoesNotThrow(() -> fixture.disconnect(players.get(0), CLEAN));
        assertTrue(fixture.allowed(fixture.login(fixture.newPlayer("Human" + (CAP + 1), UUID.randomUUID()))),
                "one slot is free after the warned disconnect");
        assertFalse(fixture.allowed(fixture.login(fixture.newPlayer("Human" + (CAP + 2), UUID.randomUUID()))));
    }

    private static IdentityPluginFixture failingProxy(Path dir, List<String> lines) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true, failingSlotLog(lines));
        fixture.init();
        fixture.syncRegistry();
        return fixture;
    }

    /** The reserve lines only. A full shard's refusal warns with "human slots", so the match is on "reserved". */
    private static List<String> reserveLines(List<String> lines) {
        return lines.stream().filter(line -> line.contains("human slot reserved")).collect(Collectors.toList());
    }

    /** A logger whose three slot lines throw, as a broken logging backend would. Every other call goes to {@link #recordingLog}. */
    private static Logger failingSlotLog(List<String> lines) {
        return slotLogThrowing(lines, () -> new IllegalStateException("the logging backend is down"));
    }

    /** A proxy on the human lane whose slot lines throw an Error, not a RuntimeException. */
    private static IdentityPluginFixture errorProxy(Path dir, List<String> lines) {
        Logger log = slotLogThrowing(lines, () -> new AssertionError("the logging backend is down"));
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true, log);
        fixture.init();
        fixture.syncRegistry();
        return fixture;
    }

    /** A logger whose slot lines throw what {@code failure} makes. Every other call goes to {@link #recordingLog}. */
    private static Logger slotLogThrowing(List<String> lines, Supplier<Throwable> failure) {
        Logger inner = recordingLog(lines);
        return (Logger) Proxy.newProxyInstance(Logger.class.getClassLoader(), new Class<?>[] {Logger.class}, (p, m, a) -> {
            if (isSlotLine(m.getName(), a)) {
                throw failure.get();
            }
            return m.invoke(inner, a);
        });
    }

    /** Whether a call is one of the slot lines. Only those throw, so the plugin's other lines run as before. */
    private static boolean isSlotLine(String level, Object[] a) {
        if (!("info".equals(level) || "warn".equals(level)) || a == null || a.length == 0) {
            return false;
        }
        String format = String.valueOf(a[0]);
        return format.startsWith("human slot reserved") || format.startsWith("human slot released")
                || format.startsWith("human slot release found");
    }
}
