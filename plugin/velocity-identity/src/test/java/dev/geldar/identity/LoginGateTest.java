package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.api.KeyValueOperation;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class LoginGateTest {
    private static final byte[] VALID = "{\"life_id\":\"life_1\",\"registered_at\":\"2026-11-09T00:00:00Z\"}".getBytes(StandardCharsets.UTF_8);

    private final LifeRegistry registry = new LifeRegistry();
    private final LoginGate gate = new LoginGate(registry);

    /** Every test starts a replay, as the registry client does before it watches the bucket. */
    @BeforeEach
    void beginReplay() {
        registry.beginReplay();
    }

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
        registry.put("alice", VALID);
        registry.markSynced();
        assertTrue(gate.admits("ALICE"));
        assertTrue(gate.admits("alice"));
    }

    @Test
    void ignoresABucketKeyThatIsNotCanonicalLowercase() {
        registry.put("Alice", VALID);
        registry.put("al ice", VALID);
        registry.put("a".repeat(17), VALID);
        registry.markSynced();
        assertFalse(gate.admits("alice"));
        assertFalse(gate.admits("Alice"));
        // A mixed-case key must not revoke or replace the canonical one either.
        registry.put("alice", VALID);
        registry.remove("ALICE");
        registry.put("ALICE", "garbage".getBytes(StandardCharsets.UTF_8));
        assertTrue(gate.admits("alice"));
    }

    @Test
    void deniesNamesThatAreNotPlainUsernames() {
        // Kelvin sign lowercases to "k" and dotted capital I to "i" in some locales; neither may match.
        registry.put("kelvin", VALID);
        registry.put("iris", VALID);
        registry.markSynced();
        assertTrue(gate.admits("kelvin"));
        assertFalse(gate.admits("\u212Aelvin"));
        assertFalse(gate.admits("\u0130ris"));
        assertFalse(gate.admits(""));
        assertFalse(gate.admits("a".repeat(17)));
        assertFalse(gate.admits("al ice"));
        assertFalse(gate.admits("alice\n"));
    }

    @Test
    void aReplayReplacesTheOldEntriesOnlyAtTheEnd() {
        registry.put("alice", VALID);
        registry.put("bob", VALID);
        registry.markSynced();

        registry.markUnsynced();
        registry.beginReplay();
        registry.put("alice", VALID);
        assertFalse(gate.admits("alice"), "closed until the replay ends");
        registry.markSynced();
        assertTrue(gate.admits("alice"));
        assertFalse(gate.admits("bob"), "a key deleted while the watch was down is gone");
    }

    @Test
    void theTailOfALostWatchDoesNotReopenTheGate() {
        registry.put("alice", VALID);
        registry.markSynced();
        registry.markUnsynced();
        // The old watch still delivers its end of data after the disconnect cleared the replay.
        registry.markSynced();
        assertFalse(registry.isSynced());
        assertFalse(gate.admits("alice"));
    }

    @Test
    void aLostWatchClosesTheGate() {
        registry.put("alice", VALID);
        registry.markSynced();
        registry.markUnsynced();
        assertFalse(gate.admits("alice"));
    }

    @Test
    void aDeleteOrPurgeFromTheWatchRevokes() {
        registry.put("alice", VALID);
        registry.put("bob", VALID);
        registry.markSynced();
        RegistryClient.apply(registry, KeyValueOperation.DELETE, "alice", null);
        RegistryClient.apply(registry, KeyValueOperation.PURGE, "bob", null);
        assertFalse(gate.admits("alice"));
        assertFalse(gate.admits("bob"));
        RegistryClient.apply(registry, KeyValueOperation.PUT, "alice", VALID);
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
