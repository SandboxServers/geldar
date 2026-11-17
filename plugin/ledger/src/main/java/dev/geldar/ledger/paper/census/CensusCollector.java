package dev.geldar.ledger.paper.census;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.census.CensusCounters;
import dev.geldar.ledger.core.census.DutyCycler;
import dev.geldar.ledger.paper.LedgerPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.event.Event;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * {@code geldar_event_count_total} and {@code geldar_event_duty_ratio}: one MONITOR registration per allow-listed event class
 * (PT-06c). The collector is OPT-IN: unless {@code collector.census.enabled=true} is set explicitly it registers nothing.
 *
 * <p>An executor only reads whether the event is cancelled; it never touches event content (S11). It runs inside the
 * collector's guard and swallows every throwable (S8). A class that fails to load or to register is skipped and counted;
 * one summary line is logged.
 */
public final class CensusCollector implements Collector {
    public static final String ID = "census";
    public static final String RESOURCE = "/ledger/census-allowlist.txt";

    private final Supplier<List<String>> allowList;
    private final Supplier<CensusRegistrar> registrarFactory;
    private final ClassLoader loader;
    private final Supplier<Logger> logger;

    private CensusRegistrar registrar;
    private volatile boolean running;
    private volatile int registered;
    private volatile int skipped;
    private Cancellable gaugeTask;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public CensusCollector() {
        this(
                CensusCollector::readResource,
                () -> new PaperCensusRegistrar(Bukkit.getPluginManager(), JavaPlugin.getPlugin(LedgerPlugin.class)),
                CensusCollector.class.getClassLoader(),
                () -> JavaPlugin.getPlugin(LedgerPlugin.class).getLogger());
    }

    CensusCollector(
            Supplier<List<String>> allowList,
            Supplier<CensusRegistrar> registrarFactory,
            ClassLoader loader,
            Supplier<Logger> logger) {
        this.allowList = allowList;
        this.registrarFactory = registrarFactory;
        this.loader = loader;
        this.logger = logger;
    }

    @Override
    public String id() {
        return ID;
    }

    /** Listeners registered by the last start. */
    public int registeredCount() {
        return registered;
    }

    /** Classes of the last start that were skipped (failed to load, excluded at run time, or failed to register). */
    public int skippedCount() {
        return skipped;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger ledger = ctx.ledger();
        LedgerConfig config = ledger.config();
        if (!Boolean.TRUE.equals(config.collectorEnabled().get(ID))) {
            return; // opt-in: 390 listeners are never registered by default
        }
        List<String> names = allowList.get();
        List<String> labels = labels(names);
        List<Class<? extends Event>> types = new ArrayList<>();
        List<String> kept = new ArrayList<>();
        int bad = 0;
        for (int i = 0; i < names.size(); i++) {
            Class<? extends Event> type = load(names.get(i));
            if (type == null) {
                bad++;
            } else {
                types.add(type);
                kept.add(labels.get(i));
            }
        }
        CensusCounters counters = new CensusCounters(ledger, kept);
        CollectorGuard guard = ledger.guard(ID);
        HostInfo host = ctx.host();
        CensusRegistrar reg = registrarFactory.get();
        Map<String, DutyCycler> duties = new HashMap<>();
        int ok = 0;
        running = true;
        registrar = reg;
        for (int i = 0; i < types.size(); i++) {
            Class<? extends Event> type = types.get(i);
            LedgerConfig.Duty d = DefaultDuty.resolve(config, kept.get(i), type.getSimpleName());
            DutyCycler duty = d == null || d.periodTicks() == 0 ? null : new DutyCycler(d.onTicks(), d.periodTicks());
            try {
                reg.register(type, new CountingExecutor(type, i, counters, duty, guard, host));
                ok++;
                if (duty != null) {
                    duties.put(kept.get(i), duty);
                }
            } catch (Throwable t) {
                bad++;
            }
        }
        registered = ok;
        skipped = bad;
        summary(ok, bad);
        if (!duties.isEmpty()) {
            registerRatios(ctx, ledger, duties);
        }
    }

    @Override
    public synchronized void stop() {
        running = false;
        CensusRegistrar r = registrar;
        registrar = null;
        Cancellable g = gaugeTask;
        gaugeTask = null;
        if (g != null) {
            g.cancel();
        }
        if (r != null) {
            r.unregisterAll();
        }
        registered = 0;
    }

    /** Gauge registration is kept off the main thread: one async run registers the ratios, then cancels itself. */
    private void registerRatios(CollectorContext ctx, Ledger ledger, Map<String, DutyCycler> duties) {
        Cancellable[] self = new Cancellable[1];
        boolean[] done = new boolean[1];
        self[0] = ctx.scheduler().everyMillis(1000L, () -> {
            synchronized (done) {
                if (done[0] || !running || ctx.host().isMainThread()) {
                    return;
                }
                done[0] = true;
            }
            try {
                for (Map.Entry<String, DutyCycler> e : duties.entrySet()) {
                    DutyCycler d = e.getValue();
                    ledger.gaugeDouble(
                            Names.Census.EVENT_DUTY_RATIO,
                            "1",
                            "Fraction of server ticks in which the census counts this event class",
                            d::ratio,
                            AttrKeys.M_EVENT_CLASS,
                            e.getKey());
                }
            } catch (Throwable ignored) {
                // a failed gauge registration must not break the collector
            }
            Cancellable me = self[0];
            if (me != null) {
                me.cancel();
            }
        });
        gaugeTask = self[0];
    }

    private void summary(int ok, int bad) {
        try {
            logger.get().info("Ledger census: " + ok + " event classes registered, " + bad + " skipped");
        } catch (Throwable ignored) {
            // logging is best effort
        }
    }

    /** Loads without initialising; null when the class is missing, not an Event, or excluded (S10). */
    private Class<? extends Event> load(String name) {
        try {
            Class<?> c = Class.forName(name, false, loader);
            if (!Event.class.isAssignableFrom(c) || CensusExclusions.isExcluded(c)) {
                return null;
            }
            return c.asSubclass(Event.class);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Metric labels for the allow-list, in order. A label is the simple name; when two or more classes share a simple name,
     * each of them gets the shortest package suffix that makes the group distinct ({@code outer.Simple}, then
     * {@code outer2.outer.Simple}, and so on), the same depth for the whole group. Deterministic, order independent.
     */
    static List<String> labels(List<String> qualified) {
        Map<String, List<Integer>> bySimple = new HashMap<>();
        for (int i = 0; i < qualified.size(); i++) {
            bySimple.computeIfAbsent(simple(qualified.get(i)), k -> new ArrayList<>()).add(i);
        }
        String[] out = new String[qualified.size()];
        for (Map.Entry<String, List<Integer>> e : bySimple.entrySet()) {
            List<Integer> group = e.getValue();
            if (group.size() == 1) {
                out[group.get(0)] = e.getKey();
                continue;
            }
            for (int depth = 1; ; depth++) {
                Map<String, Integer> seen = new HashMap<>();
                for (int idx : group) {
                    seen.merge(suffix(qualified.get(idx), depth), 1, Integer::sum);
                }
                boolean distinct = seen.size() == group.size();
                boolean exhausted = depth > maxDepth(qualified, group);
                if (distinct || exhausted) {
                    for (int idx : group) {
                        out[idx] = suffix(qualified.get(idx), depth);
                    }
                    break;
                }
            }
        }
        return List.of(out);
    }

    private static int maxDepth(List<String> qualified, List<Integer> group) {
        int max = 0;
        for (int idx : group) {
            max = Math.max(max, qualified.get(idx).split("\\.").length);
        }
        return max;
    }

    private static String simple(String qualified) {
        return qualified.substring(qualified.lastIndexOf('.') + 1);
    }

    /** The class name plus {@code depth} package segments (all of them when fewer). */
    private static String suffix(String qualified, int depth) {
        String[] parts = qualified.split("\\.");
        int from = Math.max(0, parts.length - 1 - depth);
        return String.join(".", java.util.Arrays.copyOfRange(parts, from, parts.length));
    }

    private static List<String> readResource() {
        try (InputStream in = CensusCollector.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                return List.of();
            }
            List<String> out = new ArrayList<>();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                for (String line = r.readLine(); line != null; line = r.readLine()) {
                    String t = line.strip();
                    if (!t.isEmpty() && !t.startsWith("#")) {
                        out.add(t);
                    }
                }
            }
            return out;
        } catch (IOException e) {
            return List.of();
        }
    }

    /** One per class: counts the event and nothing else. Allocation-free on the hot path. */
    private final class CountingExecutor implements EventExecutor {
        private final Class<? extends Event> type;
        private final int index;
        private final CensusCounters counters;
        private final DutyCycler duty;
        private final CollectorGuard guard;
        private final HostInfo host;

        CountingExecutor(
                Class<? extends Event> type,
                int index,
                CensusCounters counters,
                DutyCycler duty,
                CollectorGuard guard,
                HostInfo host) {
            this.type = type;
            this.index = index;
            this.counters = counters;
            this.duty = duty;
            this.guard = guard;
            this.host = host;
        }

        @Override
        public void execute(org.bukkit.event.Listener listener, Event event) {
            try {
                if (!running || !guard.allowed() || !type.isInstance(event)) {
                    return;
                }
                long t = guard.begin();
                try {
                    if (duty == null || duty.on(host.serverTick())) {
                        counters.count(index, event instanceof org.bukkit.event.Cancellable c && c.isCancelled());
                    }
                } finally {
                    guard.end(t);
                }
            } catch (Throwable ignored) {
                // S8: the census never throws into the host
            }
        }
    }
}
