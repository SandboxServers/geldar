package dev.geldar.ledger.core;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.logs.LogRecordBuilder;
import io.opentelemetry.api.logs.Logger;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Where {@link OtelEventSink} sends a finished log record: the OpenTelemetry logs bridge, or a test double. */
public interface LogOut {
    /** Called on the emitter thread only. Attributes are already allow-listed and redacted. */
    void emit(String eventName, Severity severity, String body, Map<String, Object> attrs, long timestampNanos);

    /** The adapter over the OpenTelemetry API logs bridge (a no-op without an agent). */
    static LogOut over(Logger logger) {
        return (eventName, severity, body, attrs, ts) -> {
            LogRecordBuilder b = logger.logRecordBuilder()
                    .setSeverity(toOtel(severity))
                    .setSeverityText(severity.name())
                    .setBody(body);
            if (ts > 0) {
                b.setTimestamp(ts, TimeUnit.NANOSECONDS);
            }
            b.setAttribute(AttributeKey.stringKey("event.name"), eventName);
            for (Map.Entry<String, Object> e : attrs.entrySet()) {
                Object v = e.getValue();
                if (v instanceof Long l) {
                    b.setAttribute(AttributeKey.longKey(e.getKey()), l);
                } else if (v instanceof Integer i) {
                    b.setAttribute(AttributeKey.longKey(e.getKey()), (long) i);
                } else if (v instanceof Double d) {
                    b.setAttribute(AttributeKey.doubleKey(e.getKey()), d);
                } else if (v instanceof Boolean bo) {
                    b.setAttribute(AttributeKey.booleanKey(e.getKey()), bo);
                } else if (v instanceof String s) {
                    b.setAttribute(AttributeKey.stringKey(e.getKey()), s);
                }
                // Any other type is never stringified here: the sink has already turned it into a scrubbed String.
            }
            b.emit();
        };
    }

    private static io.opentelemetry.api.logs.Severity toOtel(Severity s) {
        return switch (s) {
            case DEBUG -> io.opentelemetry.api.logs.Severity.DEBUG;
            case INFO -> io.opentelemetry.api.logs.Severity.INFO;
            case WARN -> io.opentelemetry.api.logs.Severity.WARN;
            case ERROR -> io.opentelemetry.api.logs.Severity.ERROR;
        };
    }
}
