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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.slf4j.Logger;

/** The concurrent-human cap (decision 0137), through the plugin's login and disconnect handlers. */
class HumanCapTest {
    private static final DisconnectEvent.LoginStatus CLEAN = DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN;
    /** Rounds of the simultaneous-login race; each round starts with a fresh proxy. */
    private static final int ROUNDS = 50;
    /** Logins that start together in one round. */
    private static final int LOGINS = 200;

    private static IdentityPluginFixture humanProxy(Path dir) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true);
        fixture.init();
        fixture.syncRegistry();
        return fixture;
    }

    /** Logs in {@code count} distinct humans, asserting each is admitted, and returns their UUIDs. */
    private static List<UUID> fillTo(IdentityPluginFixture fixture, int count) {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            UUID id = UUID.randomUUID();
            assertTrue(fixture.loginAllowed("Human" + i, id), "human " + i + " should be admitted");
            ids.add(id);
        }
        return ids;
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
    void fifthHumanIsAdmittedAndSixthIsRefusedWithTheGenericMessage(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        fillTo(fixture, 5);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()));
        String message = fixture.lastDenyMessage();
        assertEquals(LoginGate.DENY_MESSAGE, message, "the refusal is the one message every denial gets");
        // The message reveals neither the cap nor who is online.
        assertFalse(message.matches(".*\\d.*"), "no number in the refusal");
        for (String word : new String[] {"full", "limit", "cap", "online", "player", "slot"}) {
            assertFalse(message.toLowerCase().contains(word), word);
        }
    }

    @Test
    void aDisconnectFreesTheSlotForTheNextLogin(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        List<UUID> ids = fillTo(fixture, 5);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()));
        fixture.disconnect(ids.get(0), CLEAN);
        assertTrue(fixture.loginAllowed("Human5", UUID.randomUUID()), "the freed slot admits the next human");
        assertFalse(fixture.loginAllowed("Human6", UUID.randomUUID()), "and only that one slot was freed");
    }

    /**
     * Holder UUID X holds a slot. A second connection of X is denied; its disconnect carries X and any status Velocity
     * may report. Whatever that status, the holder keeps its slot: five humans are held and a sixth is refused.
     */
    @ParameterizedTest
    @EnumSource(DisconnectEvent.LoginStatus.class)
    void aDeniedDuplicateOfAHeldUuidNeverFreesTheHoldersSlot(DisconnectEvent.LoginStatus status, @TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        UUID shared = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", shared), "the holder is admitted");
        fillTo(fixture, 4);
        Player duplicate = fixture.newPlayer("Human0", shared);
        LoginEvent denied = fixture.login(duplicate);
        assertFalse(denied.getResult().isAllowed(), "a second login of a held UUID is refused");
        fixture.settle(denied);
        fixture.disconnect(duplicate, status);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()), status + ": the holder still holds its slot");
    }

    /** A refused duplicate that the settle step gives back must not free the holder's slot either. */
    @Test
    void aRefusedDuplicateReleasingItsOwnSlotLeavesTheHolderHeld(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        UUID shared = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", shared));
        fillTo(fixture, 4);
        LoginEvent duplicate = fixture.login(fixture.newPlayer("Human0", shared));
        fixture.settle(duplicate);
        fixture.settle(duplicate);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()), "the holder keeps its slot through a refused duplicate");
    }

    /** The holder's own disconnect frees exactly one slot: the next human fits and the one after is refused. */
    @Test
    void aHoldersOwnDisconnectFreesExactlyOneSlot(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        Player holder = fixture.newPlayer("Human0", UUID.randomUUID());
        assertTrue(fixture.allowed(fixture.login(holder)));
        fillTo(fixture, 4);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()));
        fixture.disconnect(holder, CLEAN);
        assertTrue(fixture.loginAllowed("Human5", UUID.randomUUID()), "the holder's disconnect frees its slot");
        assertFalse(fixture.loginAllowed("Human6", UUID.randomUUID()), "and exactly one");
    }

    /** Giving back the same owner's slot twice frees one slot, not two. */
    @Test
    void aSecondReleaseOfTheSameOwnerIsANoOp(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        Player holder = fixture.newPlayer("Human0", UUID.randomUUID());
        assertTrue(fixture.allowed(fixture.login(holder)));
        fillTo(fixture, 4);
        fixture.disconnect(holder, CLEAN);
        fixture.disconnect(holder, CLEAN);
        assertTrue(fixture.loginAllowed("Human5", UUID.randomUUID()), "the first disconnect frees one slot");
        assertFalse(fixture.loginAllowed("Human6", UUID.randomUUID()), "the second disconnect frees nothing more");
    }

    @Test
    void aLoginRefusedAfterItsReservationGivesTheSlotBackOnce(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        fillTo(fixture, 4);
        LoginEvent fifth = fixture.login("Human4", UUID.randomUUID());
        assertTrue(fifth.getResult().isAllowed(), "the fifth reserves the last slot");
        // A later handler denies the login after the reservation.
        fifth.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        fixture.settle(fifth);
        assertTrue(fixture.loginAllowed("Human5", UUID.randomUUID()), "the refused login's slot is free again");
        // Settling the same event again must not give back a second slot.
        fixture.settle(fifth);
        assertFalse(fixture.loginAllowed("Human6", UUID.randomUUID()), "a double settle freed nothing extra");
    }

    @Test
    void aLoginThatIsKeptHoldsItsSlotThroughSettle(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        fillTo(fixture, 4);
        LoginEvent fifth = fixture.login("Human4", UUID.randomUUID());
        fixture.settle(fifth);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()), "a kept login keeps its slot until disconnect");
    }

    @Test
    void aSecondLoginOfAHeldUuidIsRefusedWhileTheFirstHoldsTheSlot(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        UUID shared = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", shared));
        assertFalse(fixture.loginAllowed("Human0", shared), "the same UUID is not charged a second slot: it is refused");
        fillTo(fixture, 4);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()), "four others and the holder fill the cap");
    }

    @Test
    void agentNamesAreNeitherCountedNorBlockedByTheCap(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        fillTo(fixture, 4);
        // Agent names are refused by the human lane's rules before any slot is reserved.
        for (String name : new String[] {"ag_alice_01", "AG_Bob", "ag_x_02", "ag_carol_03", "ag_dan_04", "ag_eve_05"}) {
            assertFalse(fixture.loginAllowed(name, UUID.randomUUID()), name);
        }
        assertTrue(fixture.loginAllowed("Human4", UUID.randomUUID()), "the fifth human still gets the last slot");
    }

    /** A cap refusal logs its own line with the count only: no name and no UUID reach the log. */
    @Test
    void aCapRefusalLogsItsOwnCountOnlyLine(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true, recordingLog(lines));
        fixture.init();
        fixture.syncRegistry();
        fillTo(fixture, 5);
        lines.clear();
        UUID sixth = UUID.randomUUID();
        assertFalse(fixture.loginAllowed("Human5", sixth));
        assertEquals(1, lines.size(), lines.toString());
        assertEquals("warn Refused a human login: all {} human slots are held [5]", lines.get(0));
        assertFalse(lines.get(0).contains("Human5"), "no name in the cap line");
        assertFalse(lines.get(0).contains(sixth.toString()), "no UUID in the cap line");
    }

    /** An ordinary denial keeps its own line and never logs the cap line. */
    @Test
    void anOrdinaryDenialLogsItsNameLineNotTheCapLine(@TempDir Path dir) {
        List<String> lines = new ArrayList<>();
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true, recordingLog(lines));
        fixture.init();
        fixture.syncRegistry();
        lines.clear();
        assertFalse(fixture.loginAllowed("ag_alice_01", UUID.randomUUID()));
        assertEquals(1, lines.size(), lines.toString());
        assertTrue(lines.get(0).startsWith("info Denied {}"), lines.get(0));
        assertTrue(lines.stream().noneMatch(line -> line.contains("human slots")), "the cap line is for the cap only");
    }

    /**
     * Fifty rounds of 200 logins that start together through the plugin's login handler. Each round has a fresh proxy, so
     * it can admit exactly the cap; every twentieth login uses one shared UUID, which holds at most one slot.
     */
    @Test
    void simultaneousLoginsThroughThePluginAdmitExactlyTheCap(@TempDir Path dir) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(32);
        try {
            for (int round = 0; round < ROUNDS; round++) {
                IdentityPluginFixture fixture = humanProxy(dir);
                UUID shared = UUID.randomUUID();
                CountDownLatch go = new CountDownLatch(1);
                List<Future<Boolean>> results = new ArrayList<>();
                List<Boolean> sharing = new ArrayList<>();
                for (int i = 0; i < LOGINS; i++) {
                    boolean useShared = i % 20 == 0;
                    Player player = fixture.newPlayer("Human" + i, useShared ? shared : UUID.randomUUID());
                    sharing.add(useShared);
                    results.add(pool.submit(() -> {
                        go.await();
                        return fixture.allowed(fixture.login(player));
                    }));
                }
                go.countDown();
                int admitted = 0;
                int sharedAdmitted = 0;
                for (int i = 0; i < results.size(); i++) {
                    if (results.get(i).get(30, TimeUnit.SECONDS)) {
                        admitted++;
                        if (sharing.get(i)) {
                            sharedAdmitted++;
                        }
                    }
                }
                assertEquals(HumanSlots.CAP, admitted, "round " + round + ": exactly the cap is admitted");
                assertTrue(sharedAdmitted <= 1, "round " + round + ": one UUID holds at most one slot");
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
