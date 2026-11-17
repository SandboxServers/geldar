package dev.geldar.ledger.paper.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import dev.geldar.ledger.paper.LedgerPlugin;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * {@code geldar.player.advancement} and {@code geldar.player.stats} (PT-08c). Observe only: every handler is MONITOR and
 * reads the event; nothing is written to the world or to the stats directory.
 *
 * <p>OPT-IN: unless {@code collector.progress.enabled=true} is set explicitly it registers nothing (it reads player data\n * files).\n *\n * <p>Identity. Only a player whose login name has the life id shape is ever exported or read: the roster of agents
 * (UUID to life id) is built from join events and the online list, the name is read once to classify, and a human is
 * never put in it, so a human's stats file is never opened and a human's advancement is dropped. The UUID is a roster key
 * and a file name only; it is never exported. The advancement key is the namespaced id ({@code minecraft:story/root}),
 * at most {@value #MAX_KEY_CHARS} characters of {@code [a-z0-9_.-]} and {@code /}, never display text; anything else is dropped.
 *
 * <p>Threading. The advancement, join and quit handlers run on the main thread; advancement runs inside the guard. The
 * stats task runs on the async scheduler every {@value #STATS_MS} ms, reads files there (never the main thread) and
 * emits one {@code geldar.player.stats} per stat (subtype = stat name, amount = value), so the frozen attribute keys are
 * enough.
 */
public final class ProgressCollector implements Collector {
    public static final String ID = "progress";
    public static final int MAX_KEY_CHARS = 96;
    public static final long STATS_MS = 300_000L;
    static final int MAX_AGENTS = 256;
    private static final int RATE_PER_SECOND = 20;
    private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

    private final Consumer<Listener> registry;
    private final Supplier<Collection<? extends Player>> online;
    private final Supplier<Path> statsDir;
    private final SessionIds sessions;
    private final java.util.function.LongConsumer sleeper;
    private final Map<UUID, String> agents = new ConcurrentHashMap<>();
    private Listener listener;
    private Cancellable task;
    private volatile StatsFileReader reader;
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile boolean running;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public ProgressCollector() {
        this(
                l -> JavaPlugin.getPlugin(LedgerPlugin.class).listeners().register(l),
                Bukkit::getOnlinePlayers,
                () -> Bukkit.getWorlds().get(0).getWorldFolder().toPath().resolve("stats"),
                SessionIds.shared(),
                ms -> {
                    try {
                        Thread.sleep(ms);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                });
    }

    ProgressCollector(
            Consumer<Listener> registry,
            Supplier<Collection<? extends Player>> online,
            Supplier<Path> statsDir,
            SessionIds sessions,
            java.util.function.LongConsumer sleeper) {
        this.registry = registry;
        this.online = online;
        this.statsDir = statsDir;
        this.sessions = sessions;
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
        EventLog ev = l.events();
        int adv = ev.register(
                Names.Events.PLAYER_ADVANCEMENT, Severity.INFO, RATE_PER_SECOND,
                null, null, null, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE, AttrKeys.MC_SESSION);
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        Handlers h = new Handlers(guard, ev, adv);
        listener = h;
        registry.accept(h);
        seed();
        reader = StatsFileReader.open(statsDir.get(), sleeper);
        running = true;
        if (reader != null) {
            task = ctx.scheduler().everyMillis(STATS_MS, this::readStats);
        }
    }

    @Override
    public synchronized void stop() {
        running = false;
        Listener l = listener;
        Cancellable t = task;
        listener = null;
        task = null;
        reader = null;
        agents.clear();
        try {
            if (l != null) {
                HandlerList.unregisterAll(l);
            }
        } catch (Throwable e) {
            // idempotent, best effort
        }
        if (t != null) {
            t.cancel();
        }
    }

    /** The agents already online when the collector starts (a reload), classified by name shape. */
    private void seed() {
        try {
            for (Player p : online.get()) {
                add(p);
            }
        } catch (Throwable t) {
            // the join handler still fills the roster
        }
    }

    private void add(Player p) {
        String name = p.getName();
        if (LifeIds.isLifeId(name) && agents.size() < MAX_AGENTS) {
            agents.put(p.getUniqueId(), name);
        }
    }

    /** The advancement key as exported, or null when it is not a short namespaced id. */
    static String key(String raw) {
        if (raw == null || raw.isEmpty() || raw.length() > MAX_KEY_CHARS || !KEY.matcher(raw).matches()) {
            return null;
        }
        return raw;
    }

    /** Async task: one read per agent online now. Never on the main thread; never throws. */
    void readStats() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            StatsFileReader r = reader;
            CollectorGuard g = guard;
            if (!running || h == null || l == null || r == null || g == null || h.isMainThread() || !g.allowed()) {
                return;
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
                    String session = sessions.get(a.getKey());
                    for (Map.Entry<String, Long> s : stats.entrySet()) {
                        Attrs at = Attrs.of()
                                .str(AttrKeys.LIFE_ID, a.getValue())
                                .str(AttrKeys.SUBTYPE, s.getKey())
                                .lng(AttrKeys.AMOUNT, s.getValue());
                        if (session != null && !session.isEmpty()) {
                            at = at.str(AttrKeys.MC_SESSION, session);
                        }
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

    final class Handlers implements Listener {
        private final CollectorGuard guard;
        private final EventLog events;
        private final int advId;

        Handlers(CollectorGuard guard, EventLog events, int advId) {
            this.guard = guard;
            this.events = events;
            this.advId = advId;
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onAdvancement(PlayerAdvancementDoneEvent e) {
            try {
                if (!guard.allowed()) {
                    return;
                }
                long token = guard.begin();
                try {
                    Player p = e.getPlayer();
                    String name = p.getName();
                    String key = key(String.valueOf(e.getAdvancement().getKey()));
                    if (key == null || !LifeIds.isLifeId(name)) {
                        return;
                    }
                    String session = sessions.get(p.getUniqueId());
                    events.record(advId, 0, 0, 0, name, key, session == null ? "" : session);
                } finally {
                    guard.end(token);
                }
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onJoin(PlayerJoinEvent e) {
            try {
                add(e.getPlayer());
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onQuit(PlayerQuitEvent e) {
            try {
                agents.remove(e.getPlayer().getUniqueId());
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }
}
