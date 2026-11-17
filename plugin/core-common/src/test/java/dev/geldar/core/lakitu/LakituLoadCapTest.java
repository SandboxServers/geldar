package dev.geldar.core.lakitu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class LakituLoadCapTest {
    @Test
    void tenThousandUpdatesInOneTickLeaveTheQueueAtItsBound() {
        UpdateQueue q = new UpdateQueue(512);
        for (int i = 0; i < 10_000; i++) {
            q.offer(new UpdateQueue.BlockUpdate(7, "world", i, 64, 0, "minecraft:stone"));
        }
        assertEquals(512, q.size());
        assertEquals(10_000 - 512, q.droppedUpdates());
        List<UpdateQueue.BlockUpdate> drained = q.drain();
        assertEquals(512, drained.size());
        // The oldest were dropped: the survivors are the last 512.
        assertEquals(10_000 - 512, drained.get(0).x());
        assertEquals(9_999, drained.get(511).x());
        assertEquals(0, q.size());
        assertEquals(10_000 - 512, q.droppedUpdates());
    }

    @Test
    void drainingAnEmptyQueueReturnsNothingAndTheCountStaysAtZero() {
        UpdateQueue q = new UpdateQueue(4);
        assertTrue(q.drain().isEmpty());
        assertEquals(0, q.droppedUpdates());
    }

    @Test
    void theLastEntryBeforeTheBoundIsNotDroppedButTheNextOneDropsTheOldest() {
        UpdateQueue q = new UpdateQueue(3);
        for (int i = 0; i < 3; i++) {
            q.offer(new UpdateQueue.BlockUpdate(1, "w", i, 0, 0, "minecraft:dirt"));
        }
        assertEquals(0, q.droppedUpdates());
        q.offer(new UpdateQueue.BlockUpdate(1, "w", 3, 0, 0, "minecraft:dirt"));
        assertEquals(1, q.droppedUpdates());
        assertEquals(1, q.drain().get(0).x());
    }

    @Test
    void theRegistryReadsPositionsAndAnUnknownAgentHasNone() {
        AgentRegistry reg = id -> id.equals("ada")
                ? Optional.of(new AgentRegistry.AgentPosition("ada", 1.5, 64, -3.5, 90f, -10f, true))
                : Optional.empty();
        assertEquals(1.5, reg.position("ada").orElseThrow().x());
        assertTrue(reg.position("nobody").isEmpty());
    }
}
