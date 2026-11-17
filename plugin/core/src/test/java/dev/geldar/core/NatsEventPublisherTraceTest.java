package dev.geldar.core;

import dev.geldar.core.trace.OtelTraceHook;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.google.gson.JsonObject;
import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Scope;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class NatsEventPublisherTraceTest {
    private static final String TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String SPAN_ID = "00f067aa0ba902b7";
    private static final String TRACEPARENT = "00-" + TRACE_ID + "-" + SPAN_ID + "-01";

    private static EventEnvelope event() {
        return EventEnvelope.create(Instant.parse("2026-11-09T10:15:30.123Z"), "phase0", 48_500, "damage", "ag_kestrel_01", new JsonObject());
    }

    @Test
    void withoutASpanHeadersAreExactlyTheMessageId() {
        EventEnvelope event = event();
        Headers headers = NatsEventPublisher.headers(event, new OtelTraceHook());
        assertEquals(Set.of("Nats-Msg-Id"), headers.keySet());
        assertEquals(List.of(event.sourceEventId()), headers.get("Nats-Msg-Id"));
    }

    @Test
    void withASpanTheTraceparentIsAddedNextToTheMessageId() {
        EventEnvelope event = event();
        SpanContext context = SpanContext.create(TRACE_ID, SPAN_ID, TraceFlags.getSampled(), TraceState.getDefault());
        try (Scope ignored = Span.wrap(context).makeCurrent()) {
            Headers headers = NatsEventPublisher.headers(event, new OtelTraceHook());
            assertEquals(Set.of("Nats-Msg-Id", "traceparent"), headers.keySet());
            assertEquals(List.of(TRACEPARENT), headers.get("traceparent"));
            assertEquals(List.of(event.sourceEventId()), headers.get("Nats-Msg-Id"));
        }
    }

    @Test
    void theBodyIsIdenticalWithAndWithoutASpan() {
        EventEnvelope event = event();
        byte[] before = event.toBytes();
        SpanContext context = SpanContext.create(TRACE_ID, SPAN_ID, TraceFlags.getSampled(), TraceState.getDefault());
        try (Scope ignored = Span.wrap(context).makeCurrent()) {
            NatsEventPublisher.headers(event, new OtelTraceHook());
            assertArrayEquals(before, event.toBytes());
        }
        assertNull(NatsEventPublisher.headers(event, new OtelTraceHook()).get("traceparent"));
    }
}
