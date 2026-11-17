package dev.geldar.core.trace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.impl.Headers;
import io.opentelemetry.api.baggage.Baggage;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TraceHeadersTest {
    private static final String TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    @Test
    void noCurrentSpanReturnsNullAndWritesNothing() {
        Headers headers = new Headers();
        assertNull(TraceHeaders.inject(headers));
        assertNull(TraceHeaders.inject());
        assertTrue(headers.isEmpty());
    }

    @Test
    void extractIgnoresBaggageAndOtherHeaders() {
        Headers headers = new Headers();
        headers.put("traceparent", TRACEPARENT);
        headers.put("baggage", "user=alice");
        headers.put("x-custom", "v");
        Context context = TraceHeaders.extract(headers);
        assertTrue(Baggage.fromContext(context).isEmpty());
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", Span.fromContext(context).getSpanContext().getTraceId());
    }

    @Test
    void extractWithoutTraceKeysIsInvalid() {
        Headers headers = new Headers();
        headers.put("x-custom", "v");
        assertFalse(Span.fromContext(TraceHeaders.extract(headers)).getSpanContext().isValid());
        assertFalse(Span.fromContext(TraceHeaders.extract(null)).getSpanContext().isValid());
    }

    @Test
    void roundTripIsByteEqualAndOnlyTraceKeysAreWritten() {
        Headers in = new Headers();
        in.put("traceparent", TRACEPARENT);
        in.put("tracestate", "vendor=abc");
        in.put("baggage", "user=alice");
        in.put("x-custom", "v");
        Context extracted = TraceHeaders.extract(in);
        SpanContext remote = Span.fromContext(extracted).getSpanContext();
        assertTrue(remote.isValid());

        Headers out;
        try (Scope ignored = extracted.makeCurrent()) {
            out = TraceHeaders.inject();
        }
        assertEquals(Set.of("traceparent", "tracestate"), out.keySet());
        assertEquals(TRACEPARENT, out.getFirst("traceparent"));
        assertEquals("vendor=abc", out.getFirst("tracestate"));
    }

    @Test
    void emptyTracestateIsNotWritten() {
        SpanContext sc = SpanContext.create(
                "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", TraceFlags.getSampled(), TraceState.getDefault());
        Headers out;
        try (Scope ignored = Span.wrap(sc).makeCurrent()) {
            out = TraceHeaders.inject(new Headers());
        }
        assertEquals(Set.of("traceparent"), out.keySet());
        assertEquals(TRACEPARENT, out.getFirst("traceparent"));
    }

    @Test
    void injectReturnsTheSameHeadersAndKeepsExistingOnes() {
        SpanContext sc = SpanContext.create(
                "4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", TraceFlags.getSampled(), TraceState.getDefault());
        Headers given = new Headers();
        given.put("existing", "keep");
        try (Scope ignored = Span.wrap(sc).makeCurrent()) {
            assertTrue(TraceHeaders.inject(given) == given);
        }
        assertEquals("keep", given.getFirst("existing"));
        assertEquals(TRACEPARENT, given.getFirst("traceparent"));
    }
}
