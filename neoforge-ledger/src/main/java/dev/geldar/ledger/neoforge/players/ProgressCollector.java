package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongConsumer;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * {@code geldar.player.advancement} and {@code geldar.player.stats} on NeoForge (PT-N9). Loader neutral: the wiring
 * ({@link ProgressWiring}) feeds it joins, quits and advancement events; nothing here imports Minecraft.
 *
 * <p>OPT-IN: unless {@code collector.progress.enabled=true} is set explicitly it records nothing and reads no file.
 *
 * <p>Identity. Only a player whose login name has the life id shape is ever exported or read; a human is never put in
 * the roster, so a human's stats file is never opened and a human's advancement is dropped. The UUID is a roster key and
 * a file name only; it is never exported. The advancement key is the namespaced id (at most {@value #MAX_KEY_CHARS}
 * characters), never display text; anything else is dropped. {@code geldar.flag} is 1 for an earned advancement and 0
 * for a criterion grant (progress); a revoke is never exported. Earns and grants have separate rate buckets, so a burst of
 * grants (recipe unlocks) cannot drop an earn. The server creates the stats directory on its first stats save, so it is resolved
 * on the async thread on each run until it exists.
 *
 * <p>Threading. {@link #advancement} runs on the server thread inside the guard. The stats task runs on the host's async
 * scheduler, reads files there and never on the main thread, one {@code geldar.player.stats} per stat.
 */
public final class ProgressCollector implements Collector {
    public static final String ID = "progress";
    public static final int MAX_KEY_CHARS = 96;
    public static final long STATS_MS = 300_000L;
    static final int MAX_AGENTS = 256;
    private static final int RATE_PER_SECOND = 20;
    /** Longest total retry sleep in one stats run, so bad files cannot hold the shared async thread. */
    static final long SLEEP_BUDGET_MS = 5_000L;
    private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

    private final Supplier<Path> statsDir;
    private final LongConsumer sleeper;
    private final Map<UUID, String> agents = new ConcurrentHashMap<>();
    private Cancellable task;
    private volatile StatsFileReader reader;
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile int earnId = -1;
    private volatile int grantId = -1;
    private long sleepLeftMs;
    private volatile boolean running;

    /** {@code statsDir} is the world's {@code stats} directory; it is resolved on the async thread, not at start. */
    public ProgressCollector(Supplier<Path> statsDir) {
        this(statsDir, ms -> {
            try {
                Thread.sleep(ms);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }

    ProgressCollector(Supplier<Path> statsDir, LongConsumer sleeper) {
        this.statsDir = statsDir;
        this.sleeper = sleeper;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        if (!l.config().collectorEnabled(ID) || !Boolean.TRUE.equals(l.config().collectorEnabled().get(ID))) {
            return;
        }
        // Field names are positional: three longs, then three strings (a null skips a slot).
        earnId = register(l);
        grantId = register(l);
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        running = true;
        task = ctx.scheduler().everyMillis(STATS_MS, this::readStats);
    }

    private static int register(Ledger l) {
        return l.events()
                .register(
                        Names.Events.PLAYER_ADVANCEMENT,
                        Severity.INFO,
                        RATE_PER_SECOND,
                        null,
                        null,
                        AttrKeys.FLAG,
                        AttrKeys.LIFE_ID,
                        AttrKeys.SUBTYPE);
    }

    @Override
    public synchronized void stop() {
        running = false;
        Cancellable t = task;
        task = null;
        reader = null;
        agents.clear();
        if (t != null) {
            t.cancel();
        }
    }

    /** A player joined: only a life id name enters the roster, and only up to {@value #MAX_AGENTS}. */
    public void join(UUID id, String name) {
        try {
            if (running && id != null && LifeIds.isLifeId(name) && (agents.size() < MAX_AGENTS || agents.containsKey(id))) {
                agents.put(id, name);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    public void quit(UUID id) {
        try {
            if (id != null) {
                agents.remove(id);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    /** The advancement key as exported, or null when it is not a short namespaced id. */
    static String key(String raw) {
        if (raw == null || raw.isEmpty() || raw.length() > MAX_KEY_CHARS || !KEY.matcher(raw).matches()) {
            return null;
        }
        return raw;
    }

    /** An advancement event on the server thread. {@code earned} false is a criterion grant. Never throws. */
    public void advancement(String name, String rawKey, boolean earned) {
        try {
            Ledger l = ledger;
            CollectorGuard g = guard;
            HostInfo h = host;
            // The guard is main-thread state: an event on any other thread never touches it.
            if (!running || l == null || g == null || h == null || !h.isMainThread() || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                String key = key(rawKey);
                if (key == null || !LifeIds.isLifeId(name)) {
                    return;
                }
                l.events().record(earned ? earnId : grantId, 0, 0, earned ? 1 : 0, name, key, "");
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }

    /** The retry pause, spent from this run's budget; a spent budget retries at once. Async thread only. */
    private void budgetedSleep(long ms) {
        if (sleepLeftMs >= ms) {
            sleepLeftMs -= ms;
            sleeper.accept(ms);
        }
    }

    /** Async task: one read per agent online now. Never on the main thread; never throws. */
    void readStats() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            CollectorGuard g = guard;
            if (!running || h == null || l == null || g == null || h.isMainThread() || !g.allowed()) {
                return;
            }
            sleepLeftMs = SLEEP_BUDGET_MS;
            StatsFileReader r = reader;
            if (r == null) {
                r = StatsFileReader.open(statsDir.get(), this::budgetedSleep);
                if (r == null) {
                    return;
                }
                reader = r;
            }
            List<Map.Entry<UUID, String>> roster = new ArrayList<>(agents.entrySet());
            for (Map.Entry<UUID, String> a : roster) {
                if (!running) {
                    return;
                }
                try {
                    Map<String, Long> stats = r.read(a.getKey());
                    if (stats == null) {
                        continue;
                    }
                    for (Map.Entry<String, Long> s : stats.entrySet()) {
                        Attrs at = Attrs.of()
                                .str(AttrKeys.LIFE_ID, a.getValue())
                                .str(AttrKeys.SUBTYPE, s.getKey())
                                .lng(AttrKeys.AMOUNT, s.getValue());
                        l.events().emitMap(Names.Events.PLAYER_STATS, Severity.INFO, at.build());
                    }
                } catch (Throwable t) {
                    // one agent never stops the others
                }
            }
        } catch (Throwable t) {
            // never throws out of the timer
        }
    }
}
