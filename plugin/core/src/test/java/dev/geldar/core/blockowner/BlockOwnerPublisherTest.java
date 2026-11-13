package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.blockowner.OwnerCache.Pos;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class BlockOwnerPublisherTest {
    private static final Logger LOG = Logger.getLogger("blockowner-test");

    private final List<String> sent = new ArrayList<>();

    private static Pos at(int x) {
        return new Pos("world", x, 64, 0);
    }

    @Test
    void aBlockChangedTwiceInOneTickIsSentOnceWithTheLatestOwner() {
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG, 256, 16);

        publisher.changed(at(1), "alice");
        publisher.changed(at(1), null);
        publisher.flush();
        publisher.flush();

        assertEquals(1, sent.size());
        assertTrue(sent.get(0).contains("\"owner\":null"), sent.get(0));
    }

    @Test
    void flushSendsAtMostThePerTickRate() {
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG, 2, 16);
        for (int x = 1; x <= 5; x++) {
            publisher.changed(at(x), "alice");
        }

        publisher.flush();
        assertEquals(2, sent.size());
        assertEquals(3, publisher.pendingCount());

        publisher.flush();
        assertEquals(4, sent.size());

        publisher.flush();
        assertEquals(5, sent.size());
        assertEquals(0, publisher.pendingCount());
    }

    @Test
    void defaultRateIsTheDocumentedPerTickCap() {
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG);
        for (int x = 0; x < BlockOwnerPublisher.PER_TICK + 1; x++) {
            publisher.changed(at(x), "alice");
        }

        publisher.flush();

        assertEquals(BlockOwnerPublisher.PER_TICK, sent.size());
        assertEquals(1, publisher.pendingCount());
    }

    @Test
    void newBlocksBeyondTheQueueCapAreDroppedAndCounted() {
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG, 256, 2);

        publisher.changed(at(1), "alice");
        publisher.changed(at(2), "alice");
        publisher.changed(at(3), "alice");

        assertEquals(2, publisher.pendingCount());
        assertEquals(1, publisher.droppedCount());
    }

    @Test
    void aChangeToAQueuedBlockIsStillAcceptedAtTheCap() {
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(sent::add, LOG, 256, 2);
        publisher.changed(at(1), "alice");
        publisher.changed(at(2), "alice");

        publisher.changed(at(1), "bob");
        publisher.flush();

        assertEquals(0, publisher.droppedCount());
        assertEquals(2, sent.size());
        assertTrue(sent.get(0).contains("\"owner\":\"bob\""), sent.get(0));
    }
}
