package dev.geldar.ledger.core;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.common.AttributesBuilder;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * The {@link Ledger} over the OpenTelemetry API only (no SDK, no exporter). Metrics go through a {@link Meter};
 * events and content go through bounded rings drained by an {@link Emitter} into an {@link OtelEventSink}. Without an
 * agent ({@code agentPresent=false}) the API is a no-op and {@code record} returns before touching a ring (S12).
 * Nothing here throws into the host: a bad registration or a disallowed metric key is dropped and counted.
 *
 * <p>Deviation from the PT-03g card text: the card says binding a disallowed metric attribute "throws at bind".
 * This class never throws for it; the key is dropped and counted under {@code metric.attrs} (safer for the host).
 *
 * <p>Gauge attribute arguments are alternating key,value pairs (see {@link Ledger#gaugeLong}): only the keys are
 * checked with {@link AttrKeys#metricAllowed}; a disallowed key drops the whole attribute set of that registration,
 * an odd count drops the unpaired last key, a null or over-64-character value drops that pair; each is counted.
 * Registrations of one gauge name share one instrument and report one series per distinct attribute set.
 */
public final class OtelLedger implements Ledger, AutoCloseable {
    static final String RING_RATE = "events.rate";
    static final String RING_ATTRS = "attrs";
    static final String RING_MAIN_THREAD = "events.mainthread";
    static final String RING_MAP_FULL = "events.map";
    static final int MAP_CAP = 256;
    /** Longest gauge attribute value kept; the caller bounds cardinality (the area enum). */
    static final int MAX_GAUGE_VALUE = 64;
    private static final AttributeKey<String> QUEUE_KEY = AttributeKey.stringKey("queue");

    private final AtomicReference<LedgerConfig> config;
    private final HostInfo host;
    private final Logger log;
    private final Meter meter;
    private final boolean agentPresent;
    private final GuardRegistry guards;
    private final DropCounters drops = new DropCounters();
    private final LongAdder attrDrops = drops.counter(RING_ATTRS);
    private final LongAdder rateDrops = drops.counter(RING_RATE);
    private final LongAdder mainThreadDrops = drops.counter(RING_MAIN_THREAD);
    private final LongAdder mapDrops = drops.counter(RING_MAP_FULL);
    private final ConcurrentHashMap<String, ConcurrentHashMap<Attributes, LongSupplier>> longGauges =
            new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ConcurrentHashMap<Attributes, DoubleSupplier>> doubleGauges =
            new ConcurrentHashMap<>();
    private final EventDefs eventDefs = new EventDefs();
    private final EventDefs contentDefs = new EventDefs();
    private final EventRing eventRing;
    private final EventRing contentRing;
    private final ConcurrentHashMap<Long, OtelEventSink.MapEvent> maps = new ConcurrentHashMap<>();
    private final AtomicLong tickets = new AtomicLong();
    private final AtomicBoolean warnedMainThread = new AtomicBoolean();
    private final Emitter emitter;
    private final EventLog eventLog = new Events();
    private final ContentLog contentLog = new Content();

    public OtelLedger(LedgerConfig cfg, HostInfo host, Logger log, Meter meter, boolean agentPresent, LogOut out) {
        this.config = new AtomicReference<>(cfg);
        this.host = host;
        this.log = log;
        this.meter = meter;
        this.agentPresent = agentPresent;
        this.guards = new GuardRegistry(log);
        this.eventRing = new EventRing(OtelEventSink.EVENTS, capacity(cfg, OtelEventSink.EVENTS), drops);
        this.contentRing = new EventRing(OtelEventSink.CONTENT, capacity(cfg, OtelEventSink.CONTENT), drops);
        OtelEventSink sink = new OtelEventSink(
                eventDefs, contentDefs, out, () -> contentMax(config.get()), maps, attrDrops);
        this.emitter = new Emitter("geldar-ledger-emitter", List.of(eventRing, contentRing), sink);
        if (agentPresent) {
            emitter.start();
        }
        registerQueueGauges();
    }

    private static int capacity(LedgerConfig cfg, String queue) {
        int want = Math.max(LedgerConfig.MIN_QUEUE_CAPACITY, cfg.queueCapacityFor(queue));
        int pow = Integer.highestOneBit(want);
        return pow == want ? want : Math.min(pow << 1, LedgerConfig.MAX_QUEUE_CAPACITY);
    }

    private static int contentMax(LedgerConfig cfg) {
        return Math.min(cfg.contentMaxBytes(), LedgerConfig.MAX_CONTENT_BYTES);
    }

    private void registerQueueGauges() {
        try {
            // Monotonic totals: an observable counter (README section 4: counter), not a gauge.
            meter.counterBuilder(Names.Queue.DROPPED_TOTAL).buildWithCallback(m -> {
                drops.snapshot().forEach((q, n) -> m.record(n, Attributes.of(QUEUE_KEY, q)));
            });
            meter.gaugeBuilder(Names.Queue.DEPTH).ofLongs().buildWithCallback(m -> {
                m.record(eventRing.size(), Attributes.of(QUEUE_KEY, OtelEventSink.EVENTS));
                m.record(contentRing.size(), Attributes.of(QUEUE_KEY, OtelEventSink.CONTENT));
            });
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "ledger queue gauges not registered", e);
        }
    }

    private boolean active() {
        return agentPresent && config.get().enabled();
    }

    /** Applies a reloaded config snapshot (budgets, switches, content cap). Rates and capacities apply at restart. */
    public void reload(LedgerConfig cfg) {
        config.set(cfg);
        guards.reload(cfg);
    }

    /** Records currently queued in a ring ("events" or "content"); 0 for an unknown name. */
    public int queued(String queue) {
        return OtelEventSink.EVENTS.equals(queue) ? eventRing.size()
                : OtelEventSink.CONTENT.equals(queue) ? contentRing.size() : 0;
    }

    /** Count of everything dropped under a name: ring names, "attrs", "metric.attrs", "events.rate", ... */
    public long dropped(String name) {
        return drops.dropped(name);
    }

    public long sinkErrors() {
        return emitter.sinkErrors();
    }

    @Override
    public void close() {
        emitter.close();
    }

    // --- metrics ---

    /** Keeps only metric-allowed keys (S7); a rejected key is counted and its value is skipped at bind. */
    private boolean[] metricKeyMask(String[] keys) {
        boolean[] ok = new boolean[keys.length];
        for (int i = 0; i < keys.length; i++) {
            ok[i] = AttrKeys.metricAllowed(keys[i]);
            if (!ok[i]) {
                drops.counter("metric.attrs").increment();
            }
        }
        return ok;
    }

    private static Attributes attributes(String[] keys, boolean[] ok, String[] values) {
        AttributesBuilder b = Attributes.builder();
        int n = Math.min(keys.length, values == null ? 0 : values.length);
        for (int i = 0; i < n; i++) {
            if (ok[i] && values[i] != null) {
                b.put(AttributeKey.stringKey(keys[i]), values[i]);
            }
        }
        return b.build();
    }

    @Override
    public Counter counter(String name, String unit, String description, String... attrKeys) {
        String[] keys = attrKeys == null ? new String[0] : attrKeys.clone();
        boolean[] ok = metricKeyMask(keys);
        LongCounter c = guarded(() -> meter.counterBuilder(name).setUnit(unit).setDescription(description).build());
        return values -> {
            Attributes a = attributes(keys, ok, values);
            return new Bound(a, c, null);
        };
    }

    @Override
    public Histogram histogram(String name, String unit, String description, double[] bounds, String... attrKeys) {
        String[] keys = attrKeys == null ? new String[0] : attrKeys.clone();
        boolean[] ok = metricKeyMask(keys);
        DoubleHistogram h = guarded(() -> {
            var b = meter.histogramBuilder(name).setUnit(unit).setDescription(description);
            if (bounds != null && bounds.length > 0) {
                List<Double> list = new ArrayList<>(bounds.length);
                for (double d : bounds) {
                    list.add(d);
                }
                b.setExplicitBucketBoundariesAdvice(list);
            }
            return b.build();
        });
        return values -> new Bound(attributes(keys, ok, values), null, h);
    }

    private <T> T guarded(java.util.function.Supplier<T> s) {
        try {
            return s.get();
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "instrument not created", e);
            return null;
        }
    }

    /** One pre-bound attribute set; implements both bound views so the hot path is one null check and one call. */
    static final class Bound implements BoundCounter, BoundHistogram {
        private final Attributes attrs;
        private final LongCounter counter;
        private final DoubleHistogram histogram;

        Bound(Attributes attrs, LongCounter counter, DoubleHistogram histogram) {
            this.attrs = attrs;
            this.counter = counter;
            this.histogram = histogram;
        }

        Attributes attributes() {
            return attrs;
        }

        @Override
        public void add(long n) {
            if (counter != null) {
                counter.add(n, attrs);
            }
        }

        @Override
        public void record(double v) {
            if (histogram != null) {
                histogram.record(v, attrs);
            }
        }
    }

    /**
     * Builds the attribute set of one gauge registration from alternating key,value pairs. Keys only are checked.
     */
    Attributes gaugeAttributes(String[] pairs) {
        if (pairs == null || pairs.length == 0) {
            return Attributes.empty();
        }
        AttributesBuilder b = Attributes.builder();
        for (int i = 0; i < pairs.length; i += 2) {
            String key = pairs[i];
            if (!AttrKeys.metricAllowed(key)) {
                drops.counter("metric.attrs").increment();
                return Attributes.empty();
            }
            String value = i + 1 < pairs.length ? pairs[i + 1] : null;
            if (i + 1 >= pairs.length || value == null || value.length() > MAX_GAUGE_VALUE) {
                drops.counter("metric.attrs").increment();
                continue;
            }
            b.put(AttributeKey.stringKey(key), value);
        }
        return b.build();
    }

    @Override
    public void gaugeLong(String name, String unit, String description, LongSupplier reader, String... attrKeys) {
        Attributes a = gaugeAttributes(attrKeys);
        ConcurrentHashMap<Attributes, LongSupplier> series = longGauges.computeIfAbsent(name, n -> {
            ConcurrentHashMap<Attributes, LongSupplier> m = new ConcurrentHashMap<>();
            guarded(() -> meter.gaugeBuilder(n).ofLongs().setUnit(unit).setDescription(description)
                    .buildWithCallback(om -> m.forEach((at, r) -> {
                        try {
                            om.record(r.getAsLong(), at);
                        } catch (RuntimeException e) {
                            log.log(Level.FINE, "gauge reader failed", e);
                        }
                    })));
            return m;
        });
        series.put(a, reader);
    }

    @Override
    public void gaugeDouble(String name, String unit, String description, DoubleSupplier reader, String... attrKeys) {
        Attributes a = gaugeAttributes(attrKeys);
        ConcurrentHashMap<Attributes, DoubleSupplier> series = doubleGauges.computeIfAbsent(name, n -> {
            ConcurrentHashMap<Attributes, DoubleSupplier> m = new ConcurrentHashMap<>();
            guarded(() -> meter.gaugeBuilder(n).setUnit(unit).setDescription(description)
                    .buildWithCallback(om -> m.forEach((at, r) -> {
                        try {
                            om.record(r.getAsDouble(), at);
                        } catch (RuntimeException e) {
                            log.log(Level.FINE, "gauge reader failed", e);
                        }
                    })));
            return m;
        });
        series.put(a, reader);
    }
    // --- events and content ---

    private final class Events implements EventLog {
        @Override
        public int register(String eventName, Severity s, int ratePerSecond, String... fieldNames) {
            int rate = config.get().rates().getOrDefault(eventName, ratePerSecond);
            return eventDefs.add(new EventDefs.Def(
                    eventName, s, fieldNames == null ? new String[0] : fieldNames.clone(),
                    new TokenBucket(Math.max(rate, 0), System::nanoTime)));
        }

        @Override
        public void record(int id, long a, long b, long c, String s1, String s2, String s3) {
            if (!active()) {
                return;
            }
            EventDefs.Def d = eventDefs.get(id);
            if (d == null) {
                return;
            }
            if (!d.bucket.tryTake()) {
                rateDrops.increment();
                return;
            }
            eventRing.offer(id, a, b, c, s1, s2, s3);
        }

        @Override
        public void emitMap(String eventName, Severity s, Map<String, Object> attrs) {
            if (!active() || eventName == null || attrs == null) {
                return;
            }
            if (host.isMainThread()) {
                mainThreadDrops.increment();
                if (warnedMainThread.compareAndSet(false, true)) {
                    log.warning("EventLog.emitMap called on the main thread; dropped (logged once)");
                }
                return;
            }
            if (maps.size() >= MAP_CAP) {
                mapDrops.increment();
                return;
            }
            long ticket = tickets.incrementAndGet();
            maps.put(ticket, new OtelEventSink.MapEvent(eventName, s, Map.copyOf(attrs)));
            if (!eventRing.offer(OtelEventSink.MAP_ID, ticket, 0, 0, eventName, null, null)) {
                maps.remove(ticket);
            }
        }
    }

    private final class Content implements ContentLog {
        @Override
        public int register(String eventName, String... fieldNames) {
            return contentDefs.add(new EventDefs.Def(
                    eventName, Severity.INFO, fieldNames == null ? new String[0] : fieldNames.clone(), null));
        }

        /** Ring slots: s1 = text, s2 = first field, s3 = second field (+ third field joined after U+001F). */
        @Override
        public void record(int id, String text, String s1, String s2, String s3) {
            if (!active() || contentDefs.get(id) == null) {
                return;
            }
            String packed = s3 == null || s3.isEmpty() ? s2 : (s2 == null ? "" : s2) + OtelEventSink.JOIN + s3;
            contentRing.offer(id, 0, 0, 0, text, s1, packed);
        }
    }

    @Override
    public EventLog events() {
        return eventLog;
    }

    @Override
    public ContentLog content() {
        return contentLog;
    }

    @Override
    public CollectorGuard guard(String collectorId) {
        return guards.guard(collectorId, config.get());
    }

    @Override
    public LedgerConfig config() {
        return config.get();
    }
}
