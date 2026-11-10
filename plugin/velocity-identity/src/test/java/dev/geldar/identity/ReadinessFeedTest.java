package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.helpers.NOPLogger;

class ReadinessFeedTest {
    private static ReadyMarker markerIn(Path dir) {
        return new ReadyMarker(dir.resolve("geldar-identity.ready"), () -> "4242 777");
    }

    @Test
    void theMarkerIsAbsentBeforeTheRegistryIsSynced(@TempDir Path dir) {
        new ReadinessFeed(new LifeRegistry(), markerIn(dir), NOPLogger.NOP_LOGGER);
        assertFalse(Files.exists(dir.resolve("geldar-identity.ready")));
    }

    @Test
    void theMarkerAppearsOnceTheRegistryIsSynced(@TempDir Path dir) throws IOException {
        LifeRegistry registry = new LifeRegistry();
        ReadinessFeed feed = new ReadinessFeed(registry, markerIn(dir), NOPLogger.NOP_LOGGER);
        feed.beginReplay();
        feed.markSynced();
        assertTrue(registry.isSynced());
        assertEquals("4242 777\n", Files.readString(dir.resolve("geldar-identity.ready")));
    }

    @Test
    void theMarkerIsRemovedWhenTheConnectionIsLost(@TempDir Path dir) {
        ReadinessFeed feed = new ReadinessFeed(new LifeRegistry(), markerIn(dir), NOPLogger.NOP_LOGGER);
        feed.markSynced();
        feed.markUnsynced();
        assertFalse(Files.exists(dir.resolve("geldar-identity.ready")));
    }

    @Test
    void aReconnectWritesTheMarkerAgain(@TempDir Path dir) {
        ReadinessFeed feed = new ReadinessFeed(new LifeRegistry(), markerIn(dir), NOPLogger.NOP_LOGGER);
        feed.markSynced();
        feed.markUnsynced();
        feed.markSynced();
        assertTrue(Files.exists(dir.resolve("geldar-identity.ready")));
    }

    @Test
    void aFailedWriteDoesNotStopTheFeed(@TempDir Path dir) {
        LifeRegistry registry = new LifeRegistry();
        ReadyMarker missingDir = new ReadyMarker(dir.resolve("no-such-dir").resolve("geldar-identity.ready"), () -> "1 1");
        ReadinessFeed feed = new ReadinessFeed(registry, missingDir, NOPLogger.NOP_LOGGER);
        feed.beginReplay();
        feed.markSynced();
        assertTrue(registry.isSynced(), "the gate does not depend on the marker");
    }

    @Test
    void retireRemovesTheMarkerAndNothingWritesItAgain(@TempDir Path dir) {
        ReadinessFeed feed = new ReadinessFeed(new LifeRegistry(), markerIn(dir), NOPLogger.NOP_LOGGER);
        feed.markSynced();
        feed.retire();
        assertFalse(Files.exists(dir.resolve("geldar-identity.ready")));
        feed.markSynced();
        assertFalse(Files.exists(dir.resolve("geldar-identity.ready")), "a sync after shutdown writes nothing");
    }

    @Test
    void theRegistryStillReceivesTheSyncThroughTheWrapper(@TempDir Path dir) {
        LifeRegistry registry = new LifeRegistry();
        ReadinessFeed feed = new ReadinessFeed(registry, markerIn(dir), NOPLogger.NOP_LOGGER);
        feed.beginReplay();
        feed.markSynced();
        assertTrue(registry.isSynced());
        feed.markUnsynced();
        assertFalse(registry.isSynced());
    }
}
