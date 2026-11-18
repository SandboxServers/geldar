package dev.geldar.identity;

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
}
