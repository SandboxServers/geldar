package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.core.trace.SpanHearingTrace;
import dev.geldar.core.trace.SpeechHash;
import io.nats.client.Connection;
import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Scope;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** PT-11c: the hearing sink's trace seam. S2 (payload identical) and S3 (hash only, never the text). */
class NatsHearingSinkTraceTest {
    private static final String LIFE = "ag_kestrel_01";
    private static final String TEXT = "meet me at the old mill";

    private static final class Fake {
        Headers headers;
        byte[] payload;
        int publishes;

        Connection asConnection() {
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Connection.class},
                    (proxy, method, args) -> {
                        if (!method.getName().equals("publish")) {
                            throw new UnsupportedOperationException(method.getName());
                        }
                        publishes++;
                        if (args.length == 3) {
                            headers = (Headers) args[1];
                            payload = (byte[]) args[2];
                        } else {
                            headers = null;
                            payload = (byte[]) args[1];
                        }
                        return null;
                    });
        }
    }

    private static Scope enterSpan() {
        SpanContext ctx = SpanContext.create("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7",
                TraceFlags.getSampled(), TraceState.getDefault());
        return Span.wrap(ctx).makeCurrent();
    }

    @Test
    void payloadBytesAreEqualWithAndWithoutASpanAndHeadersCarryTraceparentOnly() {
        Fake plain = new Fake();
        new NatsHearingSink("phase0", plain.asConnection(), new SpanHearingTrace())
                .muffled(LIFE, "w", "far", SpeechHash.of(TEXT));
        assertNull(plain.headers);

        Fake traced = new Fake();
        try (Scope s = enterSpan()) {
            new NatsHearingSink("phase0", traced.asConnection(), new SpanHearingTrace())
                    .muffled(LIFE, "w", "far", SpeechHash.of(TEXT));
        }
        assertArrayEquals(plain.payload, traced.payload);
        assertEquals("{\"kind\":\"heard_muffled\",\"direction\":\"w\",\"band\":\"far\"}",
                new String(traced.payload, StandardCharsets.UTF_8));
        assertTrue(traced.headers.containsKey("traceparent"));
        assertEquals(1, traced.headers.size());
    }

    @Test
    void spanAttributesHoldTheLifeIdAndHashNeverTheText() {
        Map<String, String> seen = new LinkedHashMap<>();
        SpanHearingTrace trace = new SpanHearingTrace(() -> seen::put);
        Fake fake = new Fake();
        try (Scope s = enterSpan()) {
            new NatsHearingSink("phase0", fake.asConnection(), trace).muffled(LIFE, "n", "near", SpeechHash.of(TEXT));
        }
        assertEquals(Map.of("geldar.life_id", LIFE, "geldar.speech_hash", SpeechHash.of(TEXT)), seen);
        assertFalse(seen.values().stream().anyMatch(v -> v.contains("mill")));
        assertFalse(new String(fake.payload, StandardCharsets.UTF_8).contains(SpeechHash.of(TEXT)));
    }

    @Test
    void aThrowingTraceStillPublishesTheNotice() {
        Fake fake = new Fake();
        new NatsHearingSink("phase0", fake.asConnection(), (l, h) -> {
            throw new IllegalStateException("telemetry down");
        }).muffled(LIFE, "s", "far");
        assertEquals(1, fake.publishes);
        assertNull(fake.headers);
    }

    @Test
    void noSpanMeansTheOldPublishCall() {
        Fake fake = new Fake();
        new NatsHearingSink("phase0", fake.asConnection(), new SpanHearingTrace()).muffled(LIFE, "s", "far");
        assertNull(fake.headers);
        assertEquals(1, fake.publishes);
    }
}
