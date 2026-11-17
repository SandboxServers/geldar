package dev.geldar.core.trace;

import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import java.util.function.Supplier;

/** {@link TraceHook} over the OpenTelemetry API and {@link TraceHeaders}; a no-op with no agent (no valid span). */
public final class OtelTraceHook implements TraceHook {
    /** Where attributes go: the span in production, a recorder in tests. */
    public interface SpanAttributes {
        void set(String key, String value);
    }

    private final Supplier<SpanAttributes> attributes;

    public OtelTraceHook() {
        this(() -> {
            Span span = Span.current();
            return span.getSpanContext().isValid() ? span::setAttribute : null;
        });
    }

    /** For tests: attributes go to the given supplier's recorder (null means no valid span). */
    public OtelTraceHook(Supplier<SpanAttributes> attributes) {
        this.attributes = attributes;
    }

    @Override
    public Headers inject(Headers target) {
        Headers injected = TraceHeaders.inject(target);
        return injected == null ? target : injected;
    }

    @Override
    public Scope enter(Headers incoming) {
        io.opentelemetry.context.Scope scope = TraceHeaders.extract(incoming).makeCurrent();
        return scope::close;
    }

    private record Held(io.opentelemetry.context.Context context) implements Captured {}

    @Override
    public Captured capture() {
        io.opentelemetry.context.Context current = io.opentelemetry.context.Context.current();
        return Span.fromContext(current).getSpanContext().isValid() ? new Held(current) : null;
    }

    @Override
    public Headers inject(Headers target, Captured from) {
        if (!(from instanceof Held held)) {
            return inject(target);
        }
        try (io.opentelemetry.context.Scope ignored = held.context().makeCurrent()) {
            return inject(target);
        }
    }

    @Override
    public void annotate(String key, String value) {
        SpanAttributes a = attributes.get();
        if (a != null && value != null) {
            a.set(key, value);
        }
    }
}
