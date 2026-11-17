package dev.geldar.ledger.core;

import dev.geldar.ledger.core.ids.LifeIds;
import dev.geldar.ledger.core.ids.OfflineUuid;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.IntSupplier;

/**
 * Turns drained ring records into log records. Runs on the emitter thread only. Applies the attribute allow-list
 * ({@link AttrKeys#allowed}), the {@link Redactor} (S4, S5) and the content cap (S3). A throwing {@link LogOut} is
 * caught by the {@link Emitter}.
 */
final class OtelEventSink implements Sink {
    static final String EVENTS = "events";
    static final String CONTENT = "content";
    /** Ring event id of an {@code emitMap} marker; slot {@code a} holds the ticket of its payload. */
    static final int MAP_ID = -1;
    /** Joins the second and third content string into one ring slot. */
    static final char JOIN = '\u001F';

    /** Payload of an {@code emitMap} call, parked until the emitter reaches the marker. */
    record MapEvent(String name, Severity severity, Map<String, Object> attrs) {}

    private final EventDefs events;
    private final EventDefs content;
    private final LogOut out;
    private final IntSupplier contentMaxBytes;
    private final ConcurrentMap<Long, MapEvent> maps;
    private final LongAdder attrDrops;

    OtelEventSink(
            EventDefs events,
            EventDefs content,
            LogOut out,
            IntSupplier contentMaxBytes,
            ConcurrentMap<Long, MapEvent> maps,
            LongAdder attrDrops) {
        this.events = events;
        this.content = content;
        this.out = out;
        this.contentMaxBytes = contentMaxBytes;
        this.maps = maps;
        this.attrDrops = attrDrops;
    }

    @Override
    public void accept(
            String queue, int eventId, long ts, long a, long b, long c, String s1, String s2, String s3) {
        if (CONTENT.equals(queue)) {
            acceptContent(eventId, ts, s1, s2, s3);
        } else if (eventId == MAP_ID) {
            MapEvent m = maps.remove(a);
            if (m != null) {
                Map<String, Object> attrs = new LinkedHashMap<>();
                m.attrs().forEach((k, v) -> put(attrs, k, v));
                out.emit(m.name(), m.severity(), m.name(), attrs, ts);
            }
        } else {
            EventDefs.Def d = events.get(eventId);
            if (d == null) {
                return;
            }
            Map<String, Object> attrs = new LinkedHashMap<>();
            slot(attrs, d.fields, 0, a);
            slot(attrs, d.fields, 1, b);
            slot(attrs, d.fields, 2, c);
            slot(attrs, d.fields, 3, s1);
            slot(attrs, d.fields, 4, s2);
            slot(attrs, d.fields, 5, s3);
            out.emit(d.name, d.severity, d.name, attrs, ts);
        }
    }

    private void acceptContent(int id, long ts, String text, String s1, String joined) {
        EventDefs.Def d = content.get(id);
        if (d == null) {
            return;
        }
        String s2 = joined;
        String s3 = null;
        if (joined != null) {
            int j = joined.indexOf(JOIN);
            if (j >= 0) {
                s2 = joined.substring(0, j);
                s3 = joined.substring(j + 1);
            }
        }
        Map<String, Object> attrs = new LinkedHashMap<>();
        slot(attrs, d.fields, 0, s1);
        slot(attrs, d.fields, 1, s2);
        slot(attrs, d.fields, 2, s3);
        String body = text == null ? "" : Redactor.scrub(ContentCap.cap(text, contentMaxBytes.getAsInt()));
        out.emit(d.name, d.severity, body, attrs, ts);
    }

    private void slot(Map<String, Object> attrs, String[] fields, int i, Object value) {
        if (i >= fields.length || fields[i] == null) {
            return;
        }
        if (value instanceof String s && s.isEmpty()) {
            return;
        }
        if (value != null) {
            put(attrs, fields[i], value);
        }
    }

    private void put(Map<String, Object> attrs, String key, Object value) {
        if (!AttrKeys.allowed(key) || value == null) {
            attrDrops.increment();
            return;
        }
        if (AttrKeys.LIFE_ID.equals(key)) {
            String name = String.valueOf(value);
            if (!LifeIds.isLifeId(name)) {
                attrDrops.increment();
                return;
            }
            attrs.put(key, name);
            attrs.put(AttrKeys.PLAYER_UUID, OfflineUuid.of(name).toString());
            return;
        }
        if (AttrKeys.PLAYER_UUID.equals(key) && attrs.containsKey(key)) {
            return;
        }
        attrs.put(key, Redactor.redactAttr(key, value));
    }
}
