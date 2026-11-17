package dev.geldar.ledger.neoforge.state;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

/** A fake ledger, host and scheduler for the PT-N4b tests: records gauges, emitted events, tasks and guard traffic. */
public final class FakeRig {
    /** One task: the runnable, whether it runs on the main thread, and whether it was cancelled. */
    public static final class Task {
        public final Runnable body;
        public final boolean main;
        public final AtomicBoolean cancelled = new AtomicBoolean();

        Task(Runnable body, boolean main) {
            this.body = body;
            this.main = main;
        }
    }

    public final Map<String, LongSupplier> gauges = new TreeMap<>(); // "name{attrs}" to reader
    public final List<String> gaugeAttrs = new CopyOnWriteArrayList<>();
    public final List<String> events = new CopyOnWriteArrayList<>();
    public final List<Map<?, ?>> eventAttrs = new CopyOnWriteArrayList<>();
    public final List<Task> tasks = new ArrayList<>();
    public final AtomicBoolean main = new AtomicBoolean(true);
    public final AtomicBoolean allowed = new AtomicBoolean(true);
    public final AtomicInteger begins = new AtomicInteger();
    public final AtomicInteger ends = new AtomicInteger();
    public final AtomicInteger guardOffMain = new AtomicInteger();
    public final LedgerConfig config;

    public FakeRig(String... lines) {
        Properties p = new Properties();
        for (String l : lines) {
            int i = l.indexOf('=');
            p.setProperty(l.substring(0, i), l.substring(i + 1));
        }
        config = ConfigParser.parse(p).config();
    }

    public final HostInfo host = new HostInfo() {
        public long serverTick() {
            return 0;
        }

        public boolean isMainThread() {
            return main.get();
        }

        public String loaderName() {
            return "fake";
        }
    };

    public final HostScheduler scheduler = new HostScheduler() {
        public Cancellable everyTicks(int ticks, Runnable r) {
            return add(r, true);
        }

        public Cancellable everyMillis(long ms, Runnable r) {
            return add(r, false);
        }

        private Cancellable add(Runnable r, boolean onMain) {
            Task t = new Task(r, onMain);
            tasks.add(t);
            return () -> t.cancelled.set(true);
        }
    };

    private final EventLog eventLog = (EventLog) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
                if (m.getName().equals("emitMap")) {
                    events.add(String.valueOf(a[0]));
                    eventAttrs.add((Map<?, ?>) a[2]);
                    return null;
                }
                throw new UnsupportedOperationException(m.getName());
            });

    private final CollectorGuard guard = new CollectorGuard() {
        public boolean allowed() {
            return allowed.get();
        }

        public long begin() {
            if (!main.get()) {
                guardOffMain.incrementAndGet();
            }
            begins.incrementAndGet();
            return 0;
        }

        public void end(long token) {
            ends.incrementAndGet();
        }
    };

    public final Ledger ledger = (Ledger) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> switch (m.getName()) {
                case "events" -> eventLog;
                case "guard" -> guard;
                case "config" -> cfg();
                case "gaugeLong" -> {
                    String[] keys = (String[]) a[4];
                    String id = a[0] + java.util.Arrays.toString(keys);
                    gauges.put(id, (LongSupplier) a[3]);
                    gaugeAttrs.add(java.util.Arrays.toString(keys));
                    yield null;
                }
                default -> throw new UnsupportedOperationException(m.getName());
            });

    private LedgerConfig cfg() {
        return config;
    }

    public CollectorContext ctx() {
        return new dev.geldar.ledger.neoforge.CollectorCtx(ledger, host, scheduler);
    }

    /** Runs the tasks that were registered on the main thread (true) or async (false), on the matching thread flag. */
    public void runAll(boolean onMain) {
        for (Task t : new ArrayList<>(tasks)) {
            if (t.main == onMain && !t.cancelled.get()) {
                boolean was = main.get();
                main.set(onMain);
                try {
                    t.body.run();
                } finally {
                    main.set(was);
                }
            }
        }
    }
}