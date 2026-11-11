package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class KinoControlTest {
    private final List<String> out = new ArrayList<>();
    private final AtomicLong now = new AtomicLong(1_000);
    private final FakeWorld world = new FakeWorld(Set.of(FakeWorld.key(0, 0)));
    private final KinoFeed feed = new KinoFeed(world, (agent, json) -> out.add(json), 1);
    private final KinoControl control = new KinoControl(feed, now::get);

    private static String msg(String type, String agent) {
        return "{\"control_version\":1,\"type\":\"" + type + "\",\"target_agent_id\":\"" + agent + "\"}";
    }

    private void send(String type, String agent) {
        control.receive(msg(type, agent));
        control.drain();
    }

    @Test
    void startMakesATargetAndStopRemovesItWithABye() {
        send("start", "kestrel_01");
        assertTrue(feed.isTarget("kestrel_01"));
        assertTrue(out.get(0).contains("\"hello\""));
        out.clear();
        send("stop", "kestrel_01");
        assertFalse(feed.isTarget("kestrel_01"));
        assertEquals(1, out.size());
        assertTrue(out.get(0).contains("\"bye\""));
    }

    @Test
    void messagesAreQueuedUntilDrainRunsOnTheServerThread() {
        control.receive(msg("start", "kestrel_01"));
        assertFalse(feed.isTarget("kestrel_01"));
        control.drain();
        assertTrue(feed.isTarget("kestrel_01"));
    }

    @Test
    void withTheKillSwitchOffStartsAreIgnoredEvenAfterItComesBackOn() {
        feed.setEnabled(false);
        send("start", "kestrel_01");
        assertFalse(feed.isTarget("kestrel_01"));
        feed.setEnabled(true);
        control.drain();
        assertFalse(feed.isTarget("kestrel_01"));
        assertTrue(out.isEmpty());
    }

    @Test
    void aQueuedStartIsDroppedWhenTheKillSwitchGoesOffBeforeTheDrain() {
        control.receive(msg("start", "kestrel_01"));
        feed.setEnabled(false);
        feed.setEnabled(true);
        feed.setEnabled(false);
        control.drain();
        feed.setEnabled(true);
        control.drain();
        assertFalse(feed.isTarget("kestrel_01"));
    }

    @Test
    void stopsPublishNothingWhileKilled() {
        send("start", "kestrel_01");
        feed.setEnabled(false);
        out.clear();
        send("stop", "kestrel_01");
        assertTrue(out.isEmpty());
    }

    @Test
    void aSilentTargetIsStoppedAfterTheTtlAndARefreshKeepsItAlive() {
        send("start", "kestrel_01");
        now.addAndGet(KinoControl.TTL_MILLIS - 1);
        send("refresh", "kestrel_01");
        now.addAndGet(KinoControl.TTL_MILLIS);
        control.drain();
        assertTrue(feed.isTarget("kestrel_01"));
        now.addAndGet(1);
        control.drain();
        assertFalse(feed.isTarget("kestrel_01"));
    }

    @Test
    void aRefreshStartsATargetThatIsNotRunning() {
        send("refresh", "kestrel_01");
        assertTrue(feed.isTarget("kestrel_01"));
    }

    @Test
    void aRefreshDoesNotRestartARunningTarget() {
        send("start", "kestrel_01");
        out.clear();
        send("refresh", "kestrel_01");
        assertTrue(out.isEmpty());
    }

    @Test
    void aResyncSendsTheWindowAgain() {
        send("start", "kestrel_01");
        for (int i = 0; i < 10; i++) {
            feed.pump();
        }
        out.clear();
        send("resync", "kestrel_01");
        for (int i = 0; i < 10; i++) {
            feed.pump();
        }
        assertEquals(2, out.stream().filter(m -> m.contains("\"chunk_section\"")).count());
        assertTrue(out.stream().noneMatch(m -> m.contains("\"hello\"")));
    }

    @Test
    void aFloodOfCommandsForOneAgentIsOneDecisionAndReadsOnlyWithinTheBudget() {
        for (int i = 0; i < 500; i++) {
            control.receive(msg(i % 2 == 0 ? "resync" : "start", "kestrel_01"));
        }
        control.drain();
        feed.pump();
        assertTrue(feed.isTarget("kestrel_01"));
        assertEquals(1, out.stream().filter(m -> m.contains("\"hello\"")).count());
        assertTrue(world.reads <= KinoFeed.BLOCK_BUDGET_PER_TICK, "reads " + world.reads);
    }

    @Test
    void aStopAfterAFloodWinsAndARefreshNeverOverridesIt() {
        control.receive(msg("start", "kestrel_01"));
        control.receive(msg("stop", "kestrel_01"));
        control.receive(msg("refresh", "kestrel_01"));
        control.drain();
        assertFalse(feed.isTarget("kestrel_01"));
    }

    @Test
    void atMostMaxPerDrainAgentsAreHandledInOneDrain() {
        for (int i = 0; i < KinoControl.MAX_PER_DRAIN + 10; i++) {
            control.receive(msg("start", "agent_" + i));
        }
        control.drain();
        long started = out.stream().filter(m -> m.contains("\"hello\"")).count();
        assertEquals(KinoControl.MAX_PER_DRAIN, started);
    }

    @Test
    void anOfflineAgentIsNotTracked() {
        world.agent = java.util.Optional.empty();
        send("start", "kestrel_01");
        assertFalse(feed.isTarget("kestrel_01"));
        now.addAndGet(KinoControl.TTL_MILLIS + 1);
        control.drain();
        assertTrue(out.isEmpty());
    }

    @Test
    void malformedAndUnknownMessagesAreIgnored() {
        for (String bad : new String[] {
            "not json", "[]", "{}", msg("kill", "kestrel_01"), msg("start", "Bad.Name"),
            "{\"control_version\":2,\"type\":\"start\",\"target_agent_id\":\"kestrel_01\"}",
            "{\"control_version\":1,\"type\":\"start\",\"target_agent_id\":\"kestrel_01\",\"x\":1}",
            "{\"control_version\":1,\"type\":1,\"target_agent_id\":\"kestrel_01\"}"}) {
            control.receive(bad);
        }
        control.drain();
        assertFalse(feed.isTarget("kestrel_01"));
        assertTrue(out.isEmpty());
    }

    @Test
    void thePluginOnlyReadsSoNothingGoesToAPlayerOrTheWorld() {
        // The control path holds a KinoFeed and nothing else: it has no server, player or world handle.
        for (var f : KinoControl.class.getDeclaredFields()) {
            assertFalse(f.getType().getName().startsWith("org.bukkit"), f.getName());
        }
    }
}
