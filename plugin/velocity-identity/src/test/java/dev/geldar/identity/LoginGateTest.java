package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LoginGateTest {
    private static final byte[] VALID = "{\"life_id\":\"life_1\",\"registered_at\":\"2026-11-09T00:00:00Z\"}".getBytes(StandardCharsets.UTF_8);

    private final LifeRegistry registry = new LifeRegistry();
    private final LoginGate gate = new LoginGate(registry);

    @Test
    void deniesEveryoneUntilTheFirstSync() {
        registry.put("alice", VALID);
        assertFalse(gate.admits("alice"));
        registry.markSynced();
        assertTrue(gate.admits("alice"));
    }

    @Test
    void deniesAnUnknownName() {
        registry.markSynced();
        assertFalse(gate.admits("mallory"));
        assertFalse(gate.admits(null));
    }

    @Test
    void admitsAKnownNameIgnoringCase() {
        registry.put("Alice", VALID);
        registry.markSynced();
        assertTrue(gate.admits("ALICE"));
        assertTrue(gate.admits("alice"));
    }

    @Test
    void deniesARevokedName() {
        registry.put("alice", VALID);
        registry.markSynced();
        registry.remove("alice");
        assertFalse(gate.admits("alice"));
    }

    @Test
    void deniesAMalformedEntryAndRevokesWhatItReplaces() {
        registry.markSynced();
        for (String bad : new String[] {"", "not json", "[]", "{}", "{\"life_id\":\"x\"}", "{\"life_id\":1,\"registered_at\":\"t\"}", "{\"life_id\":\" \",\"registered_at\":\"t\"}"}) {
            registry.put("bob", bad.getBytes(StandardCharsets.UTF_8));
            assertFalse(gate.admits("bob"), bad);
        }
        registry.put("bob", VALID);
        assertTrue(gate.admits("bob"));
        registry.put("bob", "garbage".getBytes(StandardCharsets.UTF_8));
        assertFalse(gate.admits("bob"));
    }

    @Test
    void tracksAdmittedConnectionsForTheCommandChannel() {
        registry.put("alice", VALID);
        registry.markSynced();
        UUID ok = UUID.randomUUID();
        UUID refused = UUID.randomUUID();
        assertTrue(gate.admit(ok, "alice"));
        assertFalse(gate.admit(refused, "mallory"));
        assertTrue(gate.isAdmitted(ok));
        assertFalse(gate.isAdmitted(refused));
        gate.release(ok);
        assertFalse(gate.isAdmitted(ok));
    }

    @Test
    void denyMessageNamesNoCheck() {
        String message = LoginGate.DENY_MESSAGE.toLowerCase();
        assertFalse(message.contains("regist") || message.contains("revok") || message.contains("sync"));
    }
}
