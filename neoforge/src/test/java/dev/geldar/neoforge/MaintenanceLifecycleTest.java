package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.maintenance.MaintenanceNotices;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class MaintenanceLifecycleTest {
    private static final String SHARD = "alpha";
    private static final String PAUSE_30 = "{\"id\":\"deploy-1\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":30}";

    private final List<String> logs = new CopyOnWriteArrayList<>();
    private final List<String> broadcasts = new CopyOnWriteArrayList<>();
    private final List<String> broadcastThreads = new CopyOnWriteArrayList<>();
    private final List<String> opened = new CopyOnWriteArrayList<>();
    private final List<MaintenanceNotices> receivers = new CopyOnWriteArrayList<>();
    private final AtomicInteger closes = new AtomicInteger();
    private final Queue<Runnable> serverQueue = new ConcurrentLinkedQueue<>();
    /** The stand-in server thread: the hand-off queues tasks here, they run only in {@link #serverTick}. */
    private final Executor serverThread = serverQueue::add;
    private volatile RuntimeException openFailure;
    private volatile boolean closeFails;

    private final OperatorSink sink = new OperatorSink() {
        @Override
        public void info(String message) {
            logs.add("info: " + message);
        }

        @Override
        public void warn(String message) {
            logs.add("warn: " + message);
        }
    };

    private MaintenanceLifecycle.SubscriberFactory factory() {
        return (url, shard, setting, log, notices) -> {
            if (openFailure != null) {
                throw openFailure;
            }
            opened.add(url + " " + shard);
            receivers.add(notices);
            return () -> {
                closes.incrementAndGet();
                if (closeFails) {
                    throw new IOException("close failed");
                }
            };
        };
    }

    private MaintenanceLifecycle lifecycle(boolean exportEnabled) {
        ExportConfig config = new ExportConfig(exportEnabled, "nats://nats:4222", SHARD, null, null, 10);
        return new MaintenanceLifecycle(config, factory(), serverThread, text -> {
            broadcasts.add(text);
            broadcastThreads.add(Thread.currentThread().getName());
        }, sink);
    }

    /** The NATS side: what core-common's dispatcher would hand to the notice receiver. */
    private MaintenanceNotices receiver() {
        return receivers.get(receivers.size() - 1);
    }

    /** Runs the queued server tasks on a thread named "fake-server", as the server thread would. */
    private void serverTick() throws InterruptedException {
        Thread server = new Thread(() -> {
            Runnable task;
            while ((task = serverQueue.poll()) != null) {
                task.run();
            }
        }, "fake-server");
        server.start();
        server.join(5_000);
    }

    @Test
    void validWorldPauseSaysOneFixedLineOnTheServerThread() throws InterruptedException {
        MaintenanceLifecycle m = lifecycle(true);
        m.start();
        receiver().receive(PAUSE_30);
        assertTrue(broadcasts.isEmpty(), "the NATS side must not broadcast");
        serverTick();
        assertEquals(List.of("Server maintenance in 30 seconds."), broadcasts);
        assertEquals(List.of("fake-server"), broadcastThreads);
        assertFalse(broadcastThreads.contains(Thread.currentThread().getName()));
    }

    @Test
    void invalidOversizedAndWrongSchemaNoticesAreDropped() throws InterruptedException {
        MaintenanceLifecycle m = lifecycle(true);
        m.start();
        List<String> bad = new ArrayList<>(List.of(
                "not json",
                "[\"x\"]",
                "{\"id\":\"x1\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":5,\"extra\":1}",
                "{\"id\":\"x2\",\"kind\":\"explode\",\"scope\":\"world\"}",
                "{\"id\":\"x3\",\"kind\":\"pause\",\"scope\":\"lobby\"}",
                "{\"id\":\"x4\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":601}",
                "{\"id\":\"x5\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":\"5\"}",
                "{\"id\":\"x6\",\"kind\":\"pause\"}",
                "{\"id\":\"BIG\",\"kind\":\"back\",\"scope\":\"world\"}",
                "{\"id\":\"" + "a".repeat(100) + "\",\"kind\":\"back\",\"scope\":\"world\"}",
                "{\"id\":\"big2\",\"kind\":\"back\",\"scope\":\"world\",\"note\":\"" + "x".repeat(200_000) + "\"}"));
        for (String payload : bad) {
            receiver().receive(payload);
        }
        serverTick();
        assertEquals(List.of(), broadcasts);
        // The pipe still works after the bad ones: exactly one line for the valid notice.
        receiver().receive(PAUSE_30);
        serverTick();
        assertEquals(List.of("Server maintenance in 30 seconds."), broadcasts);
    }

    @Test
    void duplicateNoticeIsSaidOnce() throws InterruptedException {
        MaintenanceLifecycle m = lifecycle(true);
        m.start();
        receiver().receive(PAUSE_30);
        receiver().receive(PAUSE_30);
        serverTick();
        assertEquals(1, broadcasts.size());
    }

    @Test
    void rateLimitMatchesPaperFourLinesPerWindow() throws InterruptedException {
        MaintenanceLifecycle m = lifecycle(true);
        m.start();
        for (int i = 1; i <= 5; i++) {
            receiver().receive("{\"id\":\"n" + i + "\",\"kind\":\"back\",\"scope\":\"world\"}");
        }
        serverTick();
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW, broadcasts.size());
        assertEquals("Server maintenance finished.", broadcasts.get(0));
    }

    @Test
    void disabledExportOpensNoSubscription() {
        lifecycle(false).start();
        assertEquals(List.of(), opened);
    }

    @Test
    void enabledExportSubscribesWithItsUrlAndShard() {
        lifecycle(true).start();
        assertEquals(List.of("nats://nats:4222 " + SHARD), opened);
    }

    @Test
    void subjectIsTheShardsMaintenanceSubject() {
        assertEquals("geldar.alpha.maintenance", MaintenanceLifecycle.subject("alpha"));
        assertNotEquals("geldar.beta.maintenance", MaintenanceLifecycle.subject("alpha"));
    }

    @Test
    void natsDownLogsOneWarningAndDoesNotThrow() {
        openFailure = new IllegalStateException("nats down");
        MaintenanceLifecycle m = lifecycle(true);
        assertDoesNotThrow(m::start);
        assertDoesNotThrow(m::stop);
        assertEquals(1, logs.stream().filter(l -> l.startsWith("warn:")).count());
        assertTrue(logs.get(0).contains("IllegalStateException"));
        assertEquals(0, closes.get());
    }

    @Test
    void stopClosesOnceAndACloseFailureIsWarnedNotThrown() {
        MaintenanceLifecycle m = lifecycle(true);
        m.start();
        m.stop();
        m.stop();
        assertEquals(1, closes.get());

        closeFails = true;
        MaintenanceLifecycle again = lifecycle(true);
        again.start();
        assertDoesNotThrow(again::stop);
        assertTrue(logs.get(logs.size() - 1).startsWith("warn: geldar_neoforge maintenance notices did not close"));
    }
}
