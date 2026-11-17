package dev.geldar.core.maintenance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class MaintenanceTraceTest {
    private static final String TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final byte[] NOTICE =
            "{\"id\":\"deploy-1\",\"kind\":\"pause\",\"scope\":\"world\",\"seconds\":60}".getBytes(StandardCharsets.UTF_8);

    private final List<String> said = new ArrayList<>();
    private final List<String> tracesSeen = new ArrayList<>();
    private final MaintenanceNotices notices = new MaintenanceNotices(
            true,
            line -> {
                said.add(line);
                tracesSeen.add(Span.current().getSpanContext().getTraceId());
            },
            Runnable::run,
            () -> 1_000L,
            Logger.getAnonymousLogger());

    @Test
    void theNoticeIsHandledInsideTheExtractedContext() {
        Headers headers = new Headers();
        headers.put("traceparent", "00-" + TRACE_ID + "-00f067aa0ba902b7-01");
        NatsMaintenanceSubscriber.handle(headers, NOTICE, notices);
        assertEquals(List.of("Server maintenance in 60 seconds."), said);
        assertEquals(List.of(TRACE_ID), tracesSeen);
        assertFalse(Span.current().getSpanContext().isValid(), "the scope is closed after the notice");
    }

    @Test
    void withoutHeadersTheNoticeIsHandledAsBefore() {
        NatsMaintenanceSubscriber.handle(null, NOTICE, notices);
        assertEquals(List.of("Server maintenance in 60 seconds."), said);
        assertFalse(Span.fromContext(io.opentelemetry.context.Context.current()).getSpanContext().isValid());
        assertEquals(List.of("00000000000000000000000000000000"), tracesSeen);
    }
}
