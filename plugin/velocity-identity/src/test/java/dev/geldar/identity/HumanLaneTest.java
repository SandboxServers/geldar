package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The human lane's admission rules, against a fake registry (no proxy runs). */
class HumanLaneTest {
    private static final byte[] VALID = "{\"life_id\":\"ag_alice_01\",\"registered_at\":\"2026-11-09T00:00:00Z\"}".getBytes(StandardCharsets.UTF_8);

    /** UUIDv3 of "OfflinePlayer:Notch", computed independently (PowerShell MD5 with the version and variant bits set). */
    private static final UUID OFFLINE_NOTCH = UUID.fromString("b50ad385-829d-3141-a216-7e7d7539ba7f");

    private final LifeRegistry registry = new LifeRegistry();

    /** Every test starts a replay, as the registry client does before it watches the bucket. */
    @BeforeEach
    void beginReplay() {
        registry.beginReplay();
    }

    private LoginGate humanGate() {
        return new LoginGate(registry, IdentityLane.HUMAN);
    }

    @Test
    void theOfflineUuidIsTheUuidV3OfTheOfflinePlayerName() {
        assertEquals(OFFLINE_NOTCH, HumanRules.offlineUuid("Notch"));
    }

    @Test
    void humanAdmitsAnOrdinaryNameButNeverOpensTheCommandChannel() {
        registry.markSynced();
        LoginGate gate = humanGate();
        UUID id = UUID.randomUUID();
        assertEquals(LoginGate.Admission.HUMAN, gate.decide(id, "Kiki"));
        assertTrue(gate.admit(id, "Kiki"));
        assertFalse(gate.isAdmitted(id));
        assertFalse(gate.isSpectator(id));
    }

    @Test
    void humanDeniesARegisteredAgentName() {
        registry.put("alice", VALID);
        registry.markSynced();
        LoginGate gate = humanGate();
        assertEquals(LoginGate.Admission.DENIED, gate.decide(UUID.randomUUID(), "alice"));
        assertEquals(LoginGate.Admission.DENIED, gate.decide(UUID.randomUUID(), "Alice"));
        assertFalse(gate.admit(UUID.randomUUID(), "alice"));
    }

    @Test
    void humanDeniesAnAgentShapedNameThatIsNotRegistered() {
        registry.markSynced();
        LoginGate gate = humanGate();
        // The reserved prefix is ag_, in any case; the contract's life id (ag_x_nn) lies inside it.
        for (String name : new String[] {"ag_alice_01", "AG_Bob", "ag_x"}) {
            assertEquals(LoginGate.Admission.DENIED, gate.decide(UUID.randomUUID(), name), name);
        }
        // A name that only starts with "ag" is an ordinary name.
        for (String name : new String[] {"agatha", "magic_01", "ag"}) {
            assertEquals(LoginGate.Admission.HUMAN, gate.decide(UUID.randomUUID(), name), name);
        }
    }

    @Test
    void humanDeniesTheOfflineUuidOfItsName() {
        registry.markSynced();
        LoginGate gate = humanGate();
        assertEquals(LoginGate.Admission.DENIED, gate.decide(OFFLINE_NOTCH, "Notch"));
        assertFalse(gate.admit(OFFLINE_NOTCH, "Notch"));
        assertEquals(LoginGate.Admission.HUMAN, gate.decide(UUID.randomUUID(), "Notch"));
    }

    /** Fail closed: with no registry check possible (unsynced, errored or lost), every human login is refused. */
    @Test
    void humanRefusesEveryLoginWhileTheRegistryIsNotSynced() {
        LoginGate gate = humanGate();
        assertEquals(LoginGate.Admission.DENIED, gate.decide(UUID.randomUUID(), "Kiki"), "never synced");
        registry.markSynced();
        assertEquals(LoginGate.Admission.HUMAN, gate.decide(UUID.randomUUID(), "Kiki"), "healthy registry admits");
        registry.markUnsynced();
        assertEquals(LoginGate.Admission.DENIED, gate.decide(UUID.randomUUID(), "Kiki"), "a registry error or lost sync refuses");
    }

    @Test
    void theHumanLaneNeverAnswersThroughTheAgentPath() {
        registry.put("alice", VALID);
        registry.markSynced();
        assertEquals(LoginGate.Admission.DENIED, humanGate().classify("kiki"));
    }

    @Test
    void theAgentLaneKeepsItsRulesAndIgnoresTheUuid() {
        registry.put("alice", VALID);
        registry.markSynced();
        LoginGate agent = new LoginGate(registry);
        assertEquals(LoginGate.Admission.LIVE, agent.decide(OFFLINE_NOTCH, "alice"));
        assertEquals(LoginGate.Admission.DENIED, agent.decide(UUID.randomUUID(), "kiki"));
    }

    @Test
    void theHumanDenyMessageNamesNeitherLaneNorRegistry() {
        String message = LoginGate.DENY_MESSAGE.toLowerCase();
        for (String word : new String[] {"agent", "human", "lane", "watch", "regist", "revok", "sync", "offline", "online"}) {
            assertFalse(message.contains(word), word);
        }
    }

    /** No NATS URL means no registry check, so the human lane is not ready and refuses every login, with the generic message. */
    @Test
    void humanLaneWithoutAUrlRefusesEveryLoginAndWritesNoMarker(@TempDir Path dir) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true);
        fixture.init();
        assertFalse(Files.exists(fixture.marker()), "no registry, no ready marker");
        assertFalse(fixture.loginAllowed("Kiki", UUID.randomUUID()));
        assertEquals(LoginGate.DENY_MESSAGE, fixture.lastDenyMessage());
    }

    /** A healthy registry admits an ordinary name; a registry error after that refuses it again. */
    @Test
    void humanLaneWithAHealthyRegistryAdmitsAndARegistryErrorRefuses(@TempDir Path dir) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", true);
        fixture.init();
        fixture.syncRegistry();
        assertTrue(fixture.loginAllowed("Kiki", UUID.randomUUID()), "healthy registry admits");
        fixture.unsyncRegistry();
        assertFalse(fixture.loginAllowed("Kiki", UUID.randomUUID()), "registry error refuses");
        assertEquals(LoginGate.DENY_MESSAGE, fixture.lastDenyMessage());
    }

    @Test
    void anOfflineModeProxyRefusesTheHumanLane(@TempDir Path dir) {
        IdentityPluginFixture fixture = new IdentityPluginFixture(dir, "human", false);
        fixture.init();
        fixture.syncRegistry();
        assertFalse(Files.exists(fixture.marker()), "a refused gate writes no ready marker");
        assertFalse(fixture.loginAllowed("Kiki", UUID.randomUUID()));
        assertEquals(LoginGate.DENY_MESSAGE, fixture.lastDenyMessage());
    }

    @Test
    void anUnknownLaneValueRefusesTheGate(@TempDir Path dir) {
        for (String lane : new String[] {"Human", "HUMAN", "", " human", "both"}) {
            IdentityPluginFixture fixture = new IdentityPluginFixture(dir, lane, true);
            fixture.init();
            fixture.syncRegistry();
            assertFalse(Files.exists(fixture.marker()), lane);
            assertFalse(fixture.loginAllowed("Kiki", UUID.randomUUID()), lane);
        }
    }
}
