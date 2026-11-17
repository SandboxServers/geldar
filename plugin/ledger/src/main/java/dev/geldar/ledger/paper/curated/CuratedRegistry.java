package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ContentLog;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.TokenBucket;
import dev.geldar.ledger.core.ids.LifeIds;
import dev.geldar.ledger.paper.census.CensusExclusions;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.plugin.EventExecutor;

/**
 * The curated-log mechanism (PT-07a). A family calls {@link #on} once per Bukkit event class; the registry installs one
 * MONITOR executor that reads the event through the family's {@link Extractor} into a reusable {@link FieldSink} and hands
 * the primitives to {@link EventLog#record}. The per-event rate limit is the core's token bucket (default 20 per second,
 * {@code rate.<eventName>} overrides it); excess events are dropped and counted there.
 *
 * <p>Observation only (S1): an extractor reads the event and never calls a setter. The executor runs inside the
 * collector's guard on the main thread; an event delivered on another thread is ignored, because the sinks and the guard
 * are main-thread state (S6). Every throwable is swallowed and counted (S8). A class that is excluded (S10) is refused.
 */
public final class CuratedRegistry {
    /** Reads one event into the sink. Must not change the event and must not allocate. */
    @FunctionalInterface
    public interface Extractor<E extends Event> {
        void extract(E event, FieldSink out);
    }

    /** Where executors are installed; the Paper implementation lives in {@link CuratedCollector}. */
    public interface Binder {
        void bind(Class<? extends Event> type, EventExecutor executor, boolean ignoreCancelled);

        void unbindAll();
    }

    /**
     * The reusable out-parameter of an extractor: 3 longs and 3 strings, the shape of {@code EventLog.record}. One sink
     * per registered event class, main thread only, so nothing is allocated per event.
     *
     * <p>Identity: {@link #player} stores a player name only when it is a Geldar life id. Any other name (a human
     * player) is never copied, so no such name can reach the ring (S5).
     */
    public static final class FieldSink {
        private static final int VERDICT_CAP = 256;

        public long l1;
        public long l2;
        public long l3;
        public String s1;
        public String s2;
        public String s3;
        private boolean skipped;
        /** Name to its life-id verdict, bounded; main thread only. */
        private final Map<String, Boolean> verdicts = new HashMap<>();

        void clear() {
            l1 = 0;
            l2 = 0;
            l3 = 0;
            s1 = null;
            s2 = null;
            s3 = null;
            skipped = false;
        }

        /** Record nothing for this event (for example a pickup by a non-player). */
        public void skip() {
            skipped = true;
        }

        boolean skipped() {
            return skipped;
        }

        /** Block coordinates into l1 to l3. */
        public void block(int x, int y, int z) {
            l1 = x;
            l2 = y;
            l3 = z;
        }

        /** An entity position, rounded down to its block, into l1 to l3. */
        public void at(double x, double y, double z) {
            block((int) Math.floor(x), (int) Math.floor(y), (int) Math.floor(z));
        }

        /** s1 = the player's life id; left null (the field is omitted) for any name that is not a life id. */
        public void player(Player p) {
            String name = p.getName();
            s1 = isLifeId(name) ? name : null;
        }

        private boolean isLifeId(String name) {
            if (name == null) {
                return false;
            }
            Boolean known = verdicts.get(name);
            if (known != null) {
                return known;
            }
            boolean verdict = LifeIds.isLifeId(name);
            if (verdicts.size() < VERDICT_CAP) {
                verdicts.put(name, verdict);
            }
            return verdict;
        }
    }

    /** Reads one content event (PT-07d). May run on any thread, so it must be thread-safe and must not change the event. */
    @FunctionalInterface
    public interface ContentExtractor<E extends Event> {
        void extract(E event, ContentSink out);
    }

    /**
     * The out-parameter of a {@link ContentExtractor}: the text and three field strings. One per event, because a
     * content event (chat) is delivered off the main thread. Identity as in {@link FieldSink#player}: only a life id.
     */
    public static final class ContentSink {
        public String text;
        public String s1;
        public String s2;
        public String s3;
        private boolean skipped;

        public void skip() {
            skipped = true;
        }

        /** s1 = the life id when the player's name is one; a human's name is never copied (S5). */
        public void player(Player p) {
            String name = p.getName();
            s1 = name != null && LifeIds.isLifeId(name) ? name : null;
        }
    }

    private static final int CONTENT_RATE = 20;

    private final EventLog events;
    private final ContentLog content;
    private final CollectorGuard guard;
    private final HostInfo host;
    private final Binder binder;
    private final LongAdder errors = new LongAdder();
    private final LongAdder contentRateDrops = new LongAdder();
    private int registered;

    public CuratedRegistry(EventLog events, CollectorGuard guard, HostInfo host, Binder binder) {
        this(events, null, guard, host, binder);
    }

    public CuratedRegistry(EventLog events, ContentLog content, CollectorGuard guard, HostInfo host, Binder binder) {
        this.events = events;
        this.content = content;
        this.guard = guard;
        this.host = host;
        this.binder = binder;
    }

    /** Content events dropped by the plugin-side token bucket so far. */
    public long contentRateDrops() {
        return contentRateDrops.sum();
    }

    /**
     * Registers one content event class (PT-07d). Startup only. Unlike {@link #on} the executor works on any thread and
     * never touches the {@link CollectorGuard} (the guard is main-thread state, S6): it takes only the thread-safe token
     * bucket ({@code ratePerSecond}) and the core's ring offer. Every throwable is swallowed and counted (S8).
     * {@code fieldNames} name s1 to s3. Needs a registry built with a {@link ContentLog}.
     */
    public <E extends Event> void onContent(
            Class<E> type,
            String eventName,
            int ratePerSecond,
            String[] fieldNames,
            boolean ignoreCancelled,
            ContentExtractor<E> extractor) {
        if (content == null) {
            throw new IllegalStateException("no ContentLog");
        }
        if (CensusExclusions.isExcluded(type)) {
            throw new IllegalArgumentException("excluded event class: " + type.getSimpleName());
        }
        int id = content.register(eventName, fieldNames);
        TokenBucket bucket = new TokenBucket(ratePerSecond > 0 ? ratePerSecond : CONTENT_RATE, System::nanoTime);
        binder.bind(
                type,
                (listener, event) -> {
                    if (!type.isInstance(event)) {
                        return;
                    }
                    long token = 0;
                    boolean begun = false;
                    try {
                        // The bucket comes first: a flood costs no flatten or scrub work.
                        if (!bucket.tryTake()) {
                            contentRateDrops.increment();
                            return;
                        }
                        // Main-thread events (sign, book) run under the guard; async ones never touch it (S6).
                        if (host.isMainThread()) {
                            if (!guard.allowed()) {
                                return;
                            }
                            token = guard.begin();
                            begun = true;
                        }
                        ContentSink sink = new ContentSink();
                        extractor.extract(type.cast(event), sink);
                        if (sink.skipped) {
                            return;
                        }
                        content.record(id, sink.text, sink.s1, sink.s2, sink.s3);
                    } catch (Throwable t) {
                        errors.increment();
                    } finally {
                        if (begun) {
                            try {
                                guard.end(token);
                            } catch (Throwable t) {
                                errors.increment();
                            }
                        }
                    }
                },
                ignoreCancelled);
        registered++;
    }

    /** Events registered so far. */
    public int registeredCount() {
        return registered;
    }

    /** Handler failures swallowed so far (S8). */
    public long errorCount() {
        return errors.sum();
    }

    /**
     * Registers one event class. Startup only. {@code fieldNames} name the slots l1 to l3, then s1 to s3, in that order;
     * the core accepts only allow-listed attribute keys.
     */
    public <E extends Event> void on(
            Class<E> type,
            String eventName,
            Severity severity,
            String[] fieldNames,
            boolean ignoreCancelled,
            Extractor<E> extractor) {
        if (CensusExclusions.isExcluded(type)) {
            throw new IllegalArgumentException("excluded event class: " + type.getSimpleName());
        }
        int id = events.register(eventName, severity, 20, fieldNames);
        FieldSink sink = new FieldSink();
        binder.bind(type, (listener, event) -> handle(type, id, sink, extractor, event), ignoreCancelled);
        registered++;
    }

    /** Removes every executor this registry installed. */
    public void unbindAll() {
        binder.unbindAll();
        registered = 0;
    }

    private <E extends Event> void handle(Class<E> type, int id, FieldSink sink, Extractor<E> extractor, Event event) {
        // A subclass event that shares its parent's handler list reaches the parent's executor; instanceof filters it.
        if (!type.isInstance(event) || !host.isMainThread()) {
            return;
        }
        long token = 0;
        boolean begun = false;
        try {
            if (!guard.allowed()) {
                return;
            }
            token = guard.begin();
            begun = true;
            sink.clear();
            extractor.extract(type.cast(event), sink);
            if (!sink.skipped()) {
                events.record(id, sink.l1, sink.l2, sink.l3, sink.s1, sink.s2, sink.s3);
            }
        } catch (Throwable t) {
            errors.increment();
        } finally {
            if (begun) {
                try {
                    guard.end(token);
                } catch (Throwable t) {
                    errors.increment();
                }
            }
        }
    }
}
