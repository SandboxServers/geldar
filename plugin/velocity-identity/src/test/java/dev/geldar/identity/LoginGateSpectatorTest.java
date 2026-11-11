package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The three login outcomes (live, ghost, unregistered) against a fake registry. */
class LoginGateSpectatorTest {
    private static final byte[] LIVE = "{\"life_id\":\"life_1\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8);
    private static final byte[] GHOST = "{\"life_id\":\"life_2\",\"registered_at\":\"t\",\"live\":false}".getBytes(StandardCharsets.UTF_8);
    private static final byte[] BAD_FLAG = "{\"life_id\":\"life_3\",\"registered_at\":\"t\",\"live\":\"no\"}".getBytes(StandardCharsets.UTF_8);

    private final LifeRegistry registry = new LifeRegistry();
    private final LoginGate gate = new LoginGate(registry);

    @BeforeEach
    void syncFakeRegistry() {
        registry.beginReplay();
        registry.put("alice", LIVE);
        registry.put("ghost", GHOST);
        registry.put("broken", BAD_FLAG);
        registry.markSynced();
    }

    @Test
    void aRegisteredLiveLifeIsAdmittedAsALivePlayer() {
        UUID connection = UUID.randomUUID();
        assertEquals(LoginGate.Admission.LIVE, gate.classify("alice"));
        assertTrue(gate.admit(connection, "alice"));
        assertTrue(gate.isAdmitted(connection));
        assertFalse(gate.isSpectator(connection));
    }

    @Test
    void aRegisteredGhostIsAdmittedAsASpectatorAndCannotUseTheCommandChannel() {
        UUID connection = UUID.randomUUID();
        assertEquals(LoginGate.Admission.SPECTATOR, gate.classify("ghost"));
        assertTrue(gate.admit(connection, "ghost"), "a ghost is forced to spectator, not refused");
        assertTrue(gate.isSpectator(connection));
        assertFalse(gate.isAdmitted(connection), "geldar:cmd stays closed to a ghost");
    }

    @Test
    void anUnregisteredNameIsRefusedAndNeverRecorded() {
        UUID connection = UUID.randomUUID();
        assertEquals(LoginGate.Admission.DENIED, gate.classify("mallory"));
        assertFalse(gate.admit(connection, "mallory"));
        assertFalse(gate.isAdmitted(connection));
        assertFalse(gate.isSpectator(connection));
    }

    @Test
    void aNonBooleanLiveFlagFailsClosed() {
        assertEquals(LoginGate.Admission.DENIED, gate.classify("broken"));
    }

    @Test
    void aGhostIsDeniedWhileTheRegistryIsUnsynced() {
        registry.markUnsynced();
        assertEquals(LoginGate.Admission.DENIED, gate.classify("ghost"));
    }

    @Test
    void releaseForgetsAGhostToo() {
        UUID connection = UUID.randomUUID();
        assertTrue(gate.admit(connection, "ghost"));
        gate.release(connection);
        assertFalse(gate.isSpectator(connection));
        assertFalse(gate.isAdmitted(connection));
    }

    @Test
    void theRefusalMessageNamesNeitherTheRegistryNorALifeNorAnAgent() {
        String message = LoginGate.DENY_MESSAGE.toLowerCase(Locale.ROOT);
        assertFalse(message.contains("registry"));
        assertFalse(message.contains("life"));
        assertFalse(message.contains("agent"));
    }
}
