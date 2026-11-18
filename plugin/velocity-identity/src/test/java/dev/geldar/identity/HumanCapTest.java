package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The concurrent-human cap (decision 0137), through the plugin's login handlers and against the gate directly. */
class HumanCapTest {
    private static final DisconnectEvent.LoginStatus CLEAN = DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN;

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

    @Test
    void aConflictingLoginDoesNotFreeTheSlotOfTheLoginItLost(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        List<UUID> ids = fillTo(fixture, 5);
        // A login that lost to a live player of the same name shares that player's UUID; its disconnect must not free the slot.
        fixture.disconnect(ids.get(0), DisconnectEvent.LoginStatus.CONFLICTING_LOGIN);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()));
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
    void aSecondLoginOfAHeldUuidCannotFreeTheSlotOfTheFirst(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        UUID shared = UUID.randomUUID();
        LoginEvent first = fixture.login("Human0", shared);
        assertTrue(first.getResult().isAllowed());
        // The same UUID logs in again and shares the slot; that second login is then refused.
        LoginEvent second = fixture.login("Human0", shared);
        assertTrue(second.getResult().isAllowed(), "a UUID that holds a slot is not charged a second one");
        second.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        fixture.settle(second);
        // The first login still holds the UUID's slot: four more humans fill the cap, and a sixth is refused.
        fillTo(fixture, 4);
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()));
    }

    @Test
    void sameUuidTwiceUsesOneSlot(@TempDir Path dir) {
        IdentityPluginFixture fixture = humanProxy(dir);
        UUID same = UUID.randomUUID();
        assertTrue(fixture.loginAllowed("Human0", same));
        assertTrue(fixture.loginAllowed("Human0", same), "the second login by the same UUID shares the slot");
        for (int i = 1; i < 5; i++) {
            assertTrue(fixture.loginAllowed("Human" + i, UUID.randomUUID()), "four other humans still fit");
        }
        assertFalse(fixture.loginAllowed("Human5", UUID.randomUUID()), "the cap is five distinct humans");
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

    @Test
    void simultaneousLoginsAdmitExactlyTheCap() throws Exception {
        LifeRegistry registry = new LifeRegistry();
        registry.beginReplay();
        registry.markSynced();
        LoginGate gate = new LoginGate(registry, IdentityLane.HUMAN);
        int logins = 64;
        ExecutorService pool = Executors.newFixedThreadPool(16);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Boolean>> results = new ArrayList<>();
            for (int i = 0; i < logins; i++) {
                UUID id = UUID.randomUUID();
                String name = "Human" + i;
                Callable<Boolean> login = () -> {
                    go.await();
                    return gate.admit(id, name);
                };
                results.add(pool.submit(login));
            }
            go.countDown();
            int admitted = 0;
            for (Future<Boolean> result : results) {
                if (result.get(30, TimeUnit.SECONDS)) {
                    admitted++;
                }
            }
            assertEquals(HumanSlots.CAP, admitted, "exactly the cap is admitted under simultaneous logins");
        } finally {
            pool.shutdownNow();
        }
    }
}
