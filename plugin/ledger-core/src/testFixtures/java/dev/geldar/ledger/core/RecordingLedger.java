package dev.geldar.ledger.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;

/**
 * A {@link Ledger} that remembers everything bound to it and everything recorded, with no OpenTelemetry. Collector
 * tests assert on it instead of on an exporter. When built with a {@link HostInfo} it also notes every call that the
 * frozen API forbids on the main thread (gauge reads, {@code emitMap}, registration of gauges), in
 * {@link #mainThreadViolations()}.
 */
public final class RecordingLedger implements Ledger {
    /** One {@code EventLog.record} or {@code EventLog.emitMap} call. For emitMap the numbers and strings are unset. */
    public record EventRecord(
            String name,
            Severity severity,
            long a,
            long b,
            long c,
            String s1,
            String s2,
            String s3,
            Map<String, Object> attrs) {}

    /** One {@code ContentLog.record} call. */
    public record ContentRecord(String name, String text, String s1, String s2, String s3) {}

    private record Registration(String name, Severity severity, List<String> fields) {}

    private final HostInfo host;
    private final LedgerConfig config;
    private final Map<String, LongAdder> counters = new ConcurrentHashMap<>();
    private final Map<String, List<Double>> histograms = new ConcurrentHashMap<>();
    private final Map<String, LongSupplier> longGauges = new ConcurrentHashMap<>();
    private final Map<String, DoubleSupplier> doubleGauges = new ConcurrentHashMap<>();
    private final List<Registration> eventRegs = new CopyOnWriteArrayList<>();
    private final List<Registration> contentRegs = new CopyOnWriteArrayList<>();
    private final List<EventRecord> events = new CopyOnWriteArrayList<>();
    private final List<ContentRecord> contents = new CopyOnWriteArrayList<>();
    private final List<String> violations = new CopyOnWriteArrayList<>();
    private final Map<String, FakeGuard> guards = new ConcurrentHashMap<>();

    public RecordingLedger() {
        this(null, LedgerConfig.defaults());
    }

    public RecordingLedger(HostInfo host) {
        this(host, LedgerConfig.defaults());
    }

    public RecordingLedger(HostInfo host, LedgerConfig config) {
        this.host = host;
        this.config = config;
    }

    // ---- Ledger ----

    @Override
    public Counter counter(String name, String unit, String description, String... attrKeys) {
        return values -> {
            LongAdder adder = counters.computeIfAbsent(key(name, values), k -> new LongAdder());
            return adder::add;
        };
    }

    @Override
    public Histogram histogram(String name, String unit, String description, double[] bounds, String... attrKeys) {
        return values -> {
            List<Double> list = histograms.computeIfAbsent(key(name, values), k -> new CopyOnWriteArrayList<>());
            return list::add;
        };
    }

    @Override
    public void gaugeLong(String name, String unit, String description, LongSupplier reader, String... attrKeys) {
        longGauges.put(name, reader);
    }

    @Override
    public void gaugeDouble(String name, String unit, String description, DoubleSupplier reader, String... attrKeys) {
        doubleGauges.put(name, reader);
    }

    @Override
    public EventLog events() {
        return new EventLog() {
            @Override
            public int register(String eventName, Severity s, int ratePerSecond, String... fieldNames) {
                eventRegs.add(new Registration(eventName, s, List.of(fieldNames)));
                return eventRegs.size() - 1;
            }

            @Override
            public void record(int id, long a, long b, long c, String s1, String s2, String s3) {
                Registration r = eventRegs.get(id);
                events.add(new EventRecord(r.name(), r.severity(), a, b, c, s1, s2, s3, null));
            }

            @Override
            public void emitMap(String eventName, Severity s, Map<String, Object> attrs) {
                noteMainThread("emitMap " + eventName);
                events.add(new EventRecord(eventName, s, 0, 0, 0, null, null, null, Map.copyOf(attrs)));
            }
        };
    }

    @Override
    public ContentLog content() {
        return new ContentLog() {
            @Override
            public int register(String eventName, String... fieldNames) {
                contentRegs.add(new Registration(eventName, Severity.INFO, List.of(fieldNames)));
                return contentRegs.size() - 1;
            }

            @Override
            public void record(int id, String text, String s1, String s2, String s3) {
                contents.add(new ContentRecord(contentRegs.get(id).name(), text, s1, s2, s3));
            }
        };
    }

    @Override
    public CollectorGuard guard(String collectorId) {
        return guards.computeIfAbsent(collectorId, k -> new FakeGuard());
    }

    @Override
    public LedgerConfig config() {
        return config;
    }

    // ---- assertions ----

    /** Sum of every {@code add} on the counter bound with these attribute values; 0 if never bound. */
    public long counterValue(String name, String... attrValues) {
        LongAdder adder = counters.get(key(name, attrValues));
        return adder == null ? 0 : adder.sum();
    }

    /** Values recorded on the histogram bound with these attribute values, in order. */
    public List<Double> histogramValues(String name, String... attrValues) {
        return List.copyOf(histograms.getOrDefault(key(name, attrValues), List.of()));
    }

    /** Every event (record or emitMap) with this name, in call order. */
    public List<EventRecord> events(String name) {
        List<EventRecord> out = new ArrayList<>();
        for (EventRecord e : events) {
            if (e.name().equals(name)) {
                out.add(e);
            }
        }
        return out;
    }

    public List<EventRecord> allEvents() {
        return List.copyOf(events);
    }

    public List<ContentRecord> content(String name) {
        List<ContentRecord> out = new ArrayList<>();
        for (ContentRecord c : contents) {
            if (c.name().equals(name)) {
                out.add(c);
            }
        }
        return out;
    }

    public boolean hasGauge(String name) {
        return longGauges.containsKey(name) || doubleGauges.containsKey(name);
    }

    /** Runs the registered long gauge reader as the exporter would. */
    public long readGaugeLong(String name) {
        noteMainThread("gauge read " + name);
        return longGauges.get(name).getAsLong();
    }

    public double readGaugeDouble(String name) {
        noteMainThread("gauge read " + name);
        return doubleGauges.get(name).getAsDouble();
    }

    /** Descriptions of forbidden main-thread calls seen so far. Empty when no HostInfo was given. */
    public List<String> mainThreadViolations() {
        return Collections.unmodifiableList(violations);
    }

    /** The guard handed out for a collector id; tests flip it to simulate a budget shut-off. */
    public FakeGuard fakeGuard(String collectorId) {
        return (FakeGuard) guard(collectorId);
    }

    private void noteMainThread(String what) {
        if (host != null && host.isMainThread()) {
            violations.add(what);
        }
    }

    private static String key(String name, String[] values) {
        return name + "|" + String.join(",", values);
    }

    /** A guard that allows everything until {@link #disable()}; counts begin and end calls. */
    public static final class FakeGuard implements CollectorGuard {
        private volatile boolean allowed = true;
        private final AtomicInteger begins = new AtomicInteger();
        private final AtomicInteger ends = new AtomicInteger();

        @Override
        public boolean allowed() {
            return allowed;
        }

        @Override
        public long begin() {
            begins.incrementAndGet();
            return 0L;
        }

        @Override
        public void end(long token) {
            ends.incrementAndGet();
        }

        public void disable() {
            allowed = false;
        }

        public int begins() {
            return begins.get();
        }

        public int ends() {
            return ends.get();
        }
    }
}