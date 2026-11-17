package dev.geldar.core.maintenance;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class MaintenanceNoticesTest {
    private final List<String> said = new ArrayList<>();
    private final AtomicLong now = new AtomicLong(1_000);
    private final MaintenanceNotices notices =
            new MaintenanceNotices(true, said::add, Runnable::run, now::get, Logger.getAnonymousLogger());

    private static String world(String id) {
        return "{\"id\":\"" + id + "\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":60}";
    }

    @Test
    void aWorldPauseIsBroadcastAsAServerLine() {
        notices.receive(world("deploy-1"));
        assertEquals(List.of("Server maintenance in 60 seconds."), said);
    }

    @Test
    void eachKindAndScopeHasItsOwnLine() {
        notices.receive("{\"id\":\"a\",\"kind\":\"pause\",\"scope\":\"bodies\"}");
        now.addAndGet(MaintenanceNotices.WINDOW_MILLIS);
        notices.receive("{\"id\":\"b\",\"kind\":\"restart\",\"scope\":\"world\"}");
        now.addAndGet(MaintenanceNotices.WINDOW_MILLIS);
        notices.receive("{\"id\":\"c\",\"kind\":\"back\",\"scope\":\"mcp\"}");
        assertEquals(
                List.of(
                        "Brief maintenance: some players may drop and return.",
                        "Server maintenance soon.",
                        "Server maintenance finished."),
                said);
    }

    @Test
    void aRestartOfBodiesIsNotBroadcast() {
        notices.receive("{\"id\":\"a\",\"kind\":\"restart\",\"scope\":\"bodies\"}");
        assertEquals(List.of(), said);
    }

    @Test
    void disabledBroadcastsNothingAndReEnablingBroadcastsAgain() {
        notices.setEnabled(false);
        notices.receive(world("deploy-1"));
        assertEquals(List.of(), said);
        notices.setEnabled(true);
        notices.receive(world("deploy-2"));
        assertEquals(1, said.size());
    }

    @Test
    void disablingAfterDeliveryStopsTheLineAlreadyQueued() {
        List<Runnable> queued = new ArrayList<>();
        MaintenanceNotices later =
                new MaintenanceNotices(true, said::add, queued::add, now::get, Logger.getAnonymousLogger());
        later.receive(world("deploy-1"));
        later.setEnabled(false);
        queued.forEach(Runnable::run);
        assertEquals(List.of(), said);
    }

    @Test
    void theSameIdIsBroadcastOnce() {
        notices.receive(world("deploy-1"));
        notices.receive(world("deploy-1"));
        now.addAndGet(MaintenanceNotices.WINDOW_MILLIS);
        notices.receive(world("deploy-1"));
        assertEquals(1, said.size());
    }

    @Test
    void noMoreThanTheWindowAllowsAreBroadcast() {
        for (int i = 0; i < 6; i++) {
            notices.receive(world("deploy-" + i));
        }
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW, said.size());
    }

    @Test
    void theWindowReopensAfterItExpires() {
        for (int i = 0; i < MaintenanceNotices.MAX_PER_WINDOW; i++) {
            notices.receive(world("first-" + i));
        }
        notices.receive(world("blocked"));
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW, said.size());
        now.addAndGet(MaintenanceNotices.WINDOW_MILLIS - 1);
        notices.receive(world("still-blocked"));
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW, said.size());
        now.addAndGet(1);
        notices.receive(world("open-again"));
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW + 1, said.size());
    }

    @Test
    void aRateLimitedNoticeIsDroppedAndNotBroadcastLaterWhenItComesBack() {
        for (int i = 0; i < MaintenanceNotices.MAX_PER_WINDOW; i++) {
            notices.receive(world("first-" + i));
        }
        notices.receive(world("late"));
        now.addAndGet(MaintenanceNotices.WINDOW_MILLIS);
        notices.receive(world("late"));
        assertEquals(MaintenanceNotices.MAX_PER_WINDOW, said.size());
    }

    @Test
    void invalidPayloadsBroadcastNothingAndNeverThrow() {
        assertDoesNotThrow(() -> {
            notices.receive("not json");
            notices.receive("{\"id\":\"x\",\"kind\":\"nuke\",\"scope\":\"world\"}");
            notices.receive("{\"id\":\"x\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":9999}");
            notices.receive(null);
        });
        assertEquals(List.of(), said);
    }

    @Test
    void aRejectedHandOffOrAFailedBroadcastDoesNotEscapeTheSubscriber() {
        MaintenanceNotices refusing = new MaintenanceNotices(true, said::add, r -> {
            throw new RejectedExecutionException("plugin disabled");
        }, now::get, Logger.getAnonymousLogger());
        assertDoesNotThrow(() -> refusing.receive(world("a")));
        MaintenanceNotices failing = new MaintenanceNotices(true, line -> {
            throw new IllegalStateException("server gone");
        }, Runnable::run, now::get, Logger.getAnonymousLogger());
        assertDoesNotThrow(() -> failing.receive(world("b")));
        assertTrue(said.isEmpty());
    }
}
