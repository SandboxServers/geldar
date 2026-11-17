package dev.geldar.core.trace;

import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import io.opentelemetry.context.propagation.TextMapSetter;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import java.util.List;

/**
 * Carries the W3C trace context on NATS headers. Only {@code traceparent} and {@code tracestate} are ever read or
 * written: no baggage, no other header. With no OpenTelemetry agent the API is a no-op, so {@link #inject} returns
 * {@code null} and callers send exactly what they sent before.
 */
public final class TraceHeaders {
    public static final String TRACEPARENT = "traceparent";
    public static final String TRACESTATE = "tracestate";

    private static final List<String> KEYS = List.of(TRACEPARENT, TRACESTATE);
    private static final W3CTraceContextPropagator PROPAGATOR = W3CTraceContextPropagator.getInstance();

    private static final TextMapSetter<Headers> SETTER = (headers, key, value) -> {
        if (headers != null && value != null && !value.isEmpty() && KEYS.contains(key)) {
            headers.put(key, value);
        }
    };

    private static final TextMapGetter<Headers> GETTER = new TextMapGetter<>() {
        @Override
        public Iterable<String> keys(Headers headers) {
            return KEYS;
        }

        @Override
        public String get(Headers headers, String key) {
            if (headers == null || !KEYS.contains(key)) {
                return null;
            }
            List<String> values = headers.get(key);
            return values == null || values.isEmpty() ? null : values.get(0);
        }
    };

    private TraceHeaders() {}

    /** New headers carrying the current span's context, or {@code null} when no valid span is current. */
    public static Headers inject() {
        return inject(new Headers());
    }

    /**
     * Writes the current span's context onto {@code headers} and returns it; returns {@code null} (and writes
     * nothing) when the current span context is not valid.
     */
    public static Headers inject(Headers headers) {
        if (!Span.current().getSpanContext().isValid()) {
            return null;
        }
        Headers target = headers == null ? new Headers() : headers;
        PROPAGATOR.inject(Context.current(), target, SETTER);
        return target;
    }

    /** A context built from the two trace keys only; every other header is ignored. */
    public static Context extract(Headers headers) {
        return PROPAGATOR.extract(Context.root(), headers, GETTER);
    }
}
