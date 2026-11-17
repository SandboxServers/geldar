package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.TokenBucket;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Curated structured events (PT-N7). OPT-IN: unless {@code collector.curated.enabled=true} it registers nothing. Each
 * {@link CuratedKind} has its own token bucket, at the core's {@code rate.<eventName>} (default 20), taken before the
 * reader runs, so a flood costs no reading work. A denial is forwarded to a rate-0 twin id, so the core's exported
 * rate-drop counter counts it exactly like a core drop.
 * Events arrive on the server thread, so they run under the {@link CollectorGuard}; an event on any other thread never
 * touches the guard. Nothing escapes {@link #handle}: any throwable is counted.
 *
 * <p>Identity: s1 is set only for a life id; a human name is never copied (D-A).
 */
public final class CuratedCollector implements Collector {
    public static final String ID = "curated";
    static final int RATE = 20;

    private final LongSupplier nanoClock;
    private final Map<CuratedKind, Slot> slots = new EnumMap<>(CuratedKind.class);
    private final LongAdder errors = new LongAdder();
    private final LongAdder rateDrops = new LongAdder();
    private volatile boolean active;
    private volatile EventLog events;
    private volatile CollectorGuard guard;
    private volatile HostInfo host;

    private record Slot(int id, int dropId, TokenBucket bucket) {}

    public CuratedCollector() {
        this(System::nanoTime);
    }

    CuratedCollector(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    @Override
    public String id() {
        return ID;
    }

    /** True once started with the collector enabled. */
    public boolean active() {
        return active;
    }

    public long errorCount() {
        return errors.sum();
    }

    public long rateDrops() {
        return rateDrops.sum();
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        if (!ctx.ledger().config().collectorEnabled(ID)
                || !Boolean.TRUE.equals(ctx.ledger().config().collectorEnabled().get(ID))) {
            return;
        }
        EventLog log = ctx.ledger().events();
        java.util.Map<String, Integer> rates = ctx.ledger().config().rates();
        CuratedKind[] kinds = CuratedKind.values();
        int[] ids = new int[kinds.length];
        for (int i = 0; i < kinds.length; i++) {
            ids[i] = log.register(kinds[i].eventName, Severity.INFO, RATE, kinds[i].fieldNames);
        }
        for (int i = 0; i < kinds.length; i++) {
            // Rate 0 (the config rate never reaches it, the name is not configurable): always denies and counts.
            int dropId = log.register(kinds[i].dropName, Severity.INFO, 0);
            int rate = Math.max(0, rates.getOrDefault(kinds[i].eventName, RATE));
            slots.put(kinds[i], new Slot(ids[i], dropId, new TokenBucket(rate, nanoClock)));
        }
        events = log;
        guard = ctx.ledger().guard(ID);
        host = ctx.host();
        active = true;
    }

    @Override
    public synchronized void stop() {
        active = false;
        slots.clear();
        events = null;
        guard = null;
        host = null;
    }

    /**
     * One game event. {@code read} runs only after the bucket and the guard allowed it. A cancelled event is recorded
     * as the kind's cancelled twin.
     */
    void handle(CuratedKind kind, Supplier<CuratedFields> read) {
        EventLog log = events;
        CollectorGuard g = guard;
        HostInfo h = host;
        Slot slot = active ? slots.get(kind) : null;
        if (slot == null || log == null || g == null || h == null) {
            return;
        }
        long token = 0;
        boolean begun = false;
        try {
            // The bucket comes first: a flood costs no reading work and no guard work.
            if (!slot.bucket().tryTake()) {
                rateDrops.increment();
                log.record(slot.dropId(), 0, 0, 0, null, null, null); // the core counts it as a rate drop
                return;
            }
            if (h.isMainThread()) {
                if (!g.allowed()) {
                    return;
                }
                token = g.begin();
                begun = true;
            }
            CuratedFields f = read.get();
            if (f == null) {
                return;
            }
            CuratedKind out = f.cancelled() ? kind.whenCancelled() : kind;
            String life = LifeIds.isLifeId(f.player()) ? f.player() : null;
            log.record(slots.get(out).id(), f.x(), f.y(), f.z(), life, f.what(), f.world());
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            errors.increment();
        } finally {
            if (begun) {
                try {
                    g.end(token);
                } catch (Throwable t) {
                    if (t instanceof VirtualMachineError vme) {
                        throw vme;
                    }
                    errors.increment();
                }
            }
        }
    }
}
