package dev.geldar.core.proximity;

import io.nats.client.impl.Headers;

/**
 * The trace seam of the hearing sink (PT-11c). The platform-neutral code holds no OpenTelemetry type: the Paper adapter
 * supplies an implementation over the current span. The default does nothing, so with no agent the sink publishes
 * exactly what it did before. Only a speech hash (never the text) and the life id may reach a span.
 */
public interface HearingTrace {
    /** Nothing: no span attributes and no headers. */
    HearingTrace NONE = (lifeId, speechHash) -> null;

    /**
     * Records the life id and the speech hash (nullable) on the current span, if one is valid, and returns the
     * trace headers to publish with, or {@code null} when there is no span (publish as before).
     */
    Headers begin(String lifeId, String speechHash);
}
