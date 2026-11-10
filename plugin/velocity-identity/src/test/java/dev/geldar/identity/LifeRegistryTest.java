package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * An entry expires by its NATS TTL without a delete reaching the watch, so the registry must treat an entry
 * not written or replayed for longer than its maximum age as absent, on its own clock.
 */
class LifeRegistryTest {
    private static final byte[] LIFE =
            "{\"life_id\":\"life-1\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8);

    private final AtomicLong now = new AtomicLong();
    private final LifeRegistry registry = new LifeRegistry(now::get, Duration.ofSeconds(90));

    /** Moves the local clock to {@code seconds} after the test starts. */
    private void at(long seconds) {
        now.set(Duration.ofSeconds(seconds).toNanos());
    }

    @Test
    void anEntryIsAdmittedWhileItsWriteIsWithinTheMaximumAge() {
        at(0);
        registry.put("life1", LIFE);
        at(90);
        assertTrue(registry.find("Life1").isPresent());
    }

    @Test
    void anEntryWithoutAFreshWriteIsAbsentAfterTheMaximumAge() {
        at(0);
        registry.put("life1", LIFE);
        at(91);
        assertTrue(registry.find("Life1").isEmpty());
    }

    @Test
    void aHeartbeatRewriteKeepsTheEntryAdmissible() {
        at(0);
        registry.put("life1", LIFE);
        at(80);
        registry.put("life1", LIFE);
        at(150);
        assertEquals("life-1", registry.find("life1").orElseThrow().lifeId());
        at(171);
        assertTrue(registry.find("life1").isEmpty());
    }

    @Test
    void aReplayStampsEntriesWithTheTimeTheyWereReceived() {
        at(0);
        registry.beginReplay();
        at(50);
        registry.put("life1", LIFE);
        registry.markSynced();
        at(140);
        assertTrue(registry.find("life1").isPresent());
        at(141);
        assertTrue(registry.find("life1").isEmpty());
    }

    @Test
    void aDeleteStillRemovesTheEntryAtOnce() {
        at(0);
        registry.put("life1", LIFE);
        registry.remove("life1");
        assertTrue(registry.find("life1").isEmpty());
    }
}
