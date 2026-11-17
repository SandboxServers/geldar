package dev.geldar.core.trace;

import io.nats.client.impl.Headers;

/**
 * The one trace seam of the platform-neutral code. core-common carries no OpenTelemetry, so the Paper adapter plugs
 * an implementation over the OpenTelemetry API in; {@link #NOOP} (the default everywhere) does nothing, so with no
 * agent every sender publishes exactly what it did before. Only {@code traceparent} and {@code tracestate} are ever
 * carried, and only a hash (never speech text) may reach a span.
 */
public interface TraceHook {
    /** Nothing: no headers, no attributes, no scope. */
    TraceHook NOOP = new TraceHook() {
        @Override
        public Headers inject(Headers target) {
            return target;
        }

        @Override
        public Scope enter(Headers incoming) {
            return Scope.NONE;
        }

        @Override
        public void annotate(String key, String value) {}
    };

    /**
     * Writes the current span's trace context onto {@code target} and returns it. With a null {@code target} it
     * returns new headers carrying the context, or {@code null} when no valid span is current (send as before).
     * With a non-null {@code target} and no valid span, {@code target} is returned unchanged.
     */
    Headers inject(Headers target);

    /** Makes the context carried by {@code incoming} (may be null) current until the scope is closed. */
    Scope enter(Headers incoming);

    /** Sets a string attribute on the current span, if one is valid. */
    void annotate(String key, String value);

    /** A scope that closes without throwing. */
    interface Scope extends AutoCloseable {
        Scope NONE = () -> {};

        @Override
        void close();
    }
}