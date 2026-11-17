package dev.geldar.core.trace;

import dev.geldar.core.proximity.HearingTrace;
import io.nats.client.impl.Headers;
import io.opentelemetry.api.trace.Span;
import java.util.function.Supplier;

/** {@link HearingTrace} over the current OpenTelemetry span; a no-op with no agent (no valid span). */
public final class SpanHearingTrace implements HearingTrace {
    /** Where attributes go: the span in production, a recorder in tests. */
    public interface SpanAttributes {
        void set(String key, String value);
    }

    private final Supplier<SpanAttributes> attributes;

    public SpanHearingTrace() {
        this(() -> {
            Span span = Span.current();
            return span.getSpanContext().isValid() ? span::setAttribute : null;
        });
    }

    /** For tests: attributes go to the given supplier's recorder (null means no valid span). */
    public SpanHearingTrace(Supplier<SpanAttributes> attributes) {
        this.attributes = attributes;
    }

    @Override
    public Headers begin(String lifeId, String speechHash) {
        SpanAttributes a = attributes.get();
        if (a != null) {
            a.set("geldar.life_id", lifeId);
            if (speechHash != null) {
                a.set("geldar.speech_hash", speechHash);
            }
        }
        return TraceHeaders.inject();
    }
}
