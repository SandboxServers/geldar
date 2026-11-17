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
import io.papermc.paper.event.packet.ClientTickEndEvent;
import java.util.Collection;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * {@code geldar.player.client_tick} and {@code geldar.player.command_tree} (PT-08d). Observe only: every handler is
 * MONITOR and reads the event.
 *
 * <p>OPT-IN: unless {@code collector.cadence.enabled=true} is set explicitly it registers nothing. It can be enabled by
 * config at any time (a config reload starts it).
 *
 * <p>Identity. Only a player whose login name has the life id shape is tracked or exported; a human has no slot, so no
 * count and no event. The UUID is a map key only and is never exported. Both events carry the join's {@code mc_session}.
 * A slot is bound to the {@link Player} object of its connection: a stale quit of an earlier connection of the same UUID
 * does not free the slot of the new one, and a tick-end event of an agent without a slot claims one.
 *
 * <p>Client tick. The {@link ClientTickEndEvent} handler does one map read and one atomic increment (no allocation per
 * event). An async task every {@value #CADENCE_MS} ms reads and resets each slot and emits one
 * {@code geldar.player.client_tick} per agent: {@code amount} is the count and {@code duration_ms} is the length of the
 * window the count covers (a first or last window is partial, so compare count per second, not the raw count). A zero
 * count is emitted too: a stalled client is the point. An agent that leaves has its final partial window queued (at most
 * {@value #MAX_SLOTS} waiting) and emitted by the next task. Whether a client sends the tick-end packet is unverified: a
 * zero count is a finding, not a failure.
 *
 * <p>Capacity. At most {@value #MAX_SLOTS} agents are tracked; each further agent is counted once in
 * {@link #overflowed()} and one WARNING line is logged per start. Such an agent has no cadence and no tree audit.
 *
 * <p>Command tree. See {@link CommandTreeAudit}: first tree per connection, count and hash only.
 */
public final class ClientCadenceCollector implements Collector {
    public static final String ID = "cadence";
    public static final long CADENCE_MS = 60_000L;
    static final int MAX_SLOTS = 256;
    static final int MAX_OVERFLOW_TRACKED = 4096;
    private static final Logger LOG = Logger.getLogger(ClientCadenceCollector.class.getName());

    /** One tracked connection of an agent. Identity fields are final, so a reader never sees a half-replaced slot. */
    static final class Slot {
        final UUID id;
        final String name;
        final Player player;
        final AtomicInteger count = new AtomicInteger();
        final AtomicBoolean treeSent = new AtomicBoolean();
        final AtomicBoolean pending = new AtomicBoolean();
        volatile int pendingSize;
        volatile String pendingHash = "";
        volatile long windowStart;
        volatile String lastSession;

        Slot(Player player, UUID id, String name, long now) {
            this.player = player;
            this.id = id;
            this.name = name;
            this.windowStart = now;
        }
    }

    private final Consumer<Listener> registry;
    private final Supplier<Collection<? extends Player>> online;
    private final SessionIds sessions;
    private final LongSupplier nanos;

    private final ConcurrentHashMap<UUID, Slot> index = new ConcurrentHashMap<>();
    private final ArrayBlockingQueue<Slot> departed = new ArrayBlockingQueue<>(MAX_SLOTS);
    private final Set<UUID> overflowSeen = ConcurrentHashMap.newKeySet();
    private final LongAdder overflowed = new LongAdder();
    private final AtomicBoolean overflowLogged = new AtomicBoolean();
    private final Object slotLock = new Object();

    private Listener tickListener;
    private Listener treeListener;
    private Cancellable task;
    private volatile CommandTreeAudit audit;
    private volatile Ledger ledger;
    private volatile HostInfo host;
    private volatile CollectorGuard guard;
    private volatile boolean running;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public ClientCadenceCollector() {
        this(
                l -> JavaPlugin.getPlugin(LedgerPlugin.class).listeners().register(l),
                Bukkit::getOnlinePlayers,
                SessionIds.shared(),
                System::nanoTime);
    }

    ClientCadenceCollector(
            Consumer<Listener> registry,
            Supplier<Collection<? extends Player>> online,
            SessionIds sessions,
            LongSupplier nanos) {
        this.registry = registry;
        this.online = online;
        this.sessions = sessions;
        this.nanos = nanos;
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
        int treeId = CommandTreeAudit.register(ev);
        ledger = l;
        host = ctx.host();
        guard = l.guard(ID);
        Handlers h = new Handlers(guard);
        CommandTreeAudit a = new CommandTreeAudit(guard, ev, treeId, this, nanos);
        audit = a;
        tickListener = h;
        treeListener = a;
        registry.accept(h);
        registry.accept(a);
        seed();
        running = true;
        task = ctx.scheduler().everyMillis(CADENCE_MS, this::emitCadence);
    }

    @Override
    public synchronized void stop() {
        running = false;
        Listener a = tickListener;
        Listener b = treeListener;
        Cancellable t = task;
        tickListener = null;
        treeListener = null;
        task = null;
        audit = null;
        synchronized (slotLock) {
            index.clear();
            departed.clear();
            overflowSeen.clear();
        }
        overflowLogged.set(false);
        try {
            if (a != null) {
                HandlerList.unregisterAll(a);
            }
            if (b != null) {
                HandlerList.unregisterAll(b);
            }
        } catch (Throwable e) {
            // idempotent, best effort
        }
        if (t != null) {
            t.cancel();
        }
    }

    private void seed() {
        try {
            for (Player p : online.get()) {
                claim(p);
            }
        } catch (Throwable t) {
            // the join handler still fills the slots
        }
    }

    /**
     * The slot of this connection, claimed on first sight; null for a human or when every slot is taken. A slot held by
     * another {@link Player} object of the same UUID (a reconnect) is replaced and its final window queued.
     */
    Slot claim(Player p) {
        UUID id = p.getUniqueId();
        Slot have = index.get(id);
        if (have != null && have.player == p) {
            return have;
        }
        if (have == null && index.size() >= MAX_SLOTS && overflowSeen.contains(id)) {
            return null;
        }
        String name = p.getName();
        if (!LifeIds.isLifeId(name)) {
            return null;
        }
        synchronized (slotLock) {
            have = index.get(id);
            if (have != null && have.player == p) {
                return have;
            }
            if (have == null && index.size() >= MAX_SLOTS) {
                overflow(id);
                return null;
            }
            overflowSeen.remove(id);
            Slot s = new Slot(p, id, name, nanos.getAsLong());
            s.lastSession = sessions.get(id);
            index.put(id, s);
            if (have != null) {
                retire(have);
            }
            return s;
        }
    }

    private void overflow(UUID id) {
        if (overflowSeen.size() < MAX_OVERFLOW_TRACKED && overflowSeen.add(id)) {
            overflowed.increment();
        }
        if (overflowLogged.compareAndSet(false, true)) {
            LOG.warning("Ledger collector cadence: more than " + MAX_SLOTS + " agents online; the extra agents get no client_tick or command_tree");
        }
    }

    /** Queues the slot's final window for the async task (dropped when the queue is full). */
    private void retire(Slot s) {
        String session = sessions.get(s.id);
        if (session != null) {
            s.lastSession = session;
        }
        departed.offer(s);
    }

    private void release(Player p) {
        synchronized (slotLock) {
            overflowSeen.remove(p.getUniqueId());
            Slot s = index.get(p.getUniqueId());
            if (s != null && s.player == p) {
                index.remove(p.getUniqueId());
                retire(s);
            }
        }
    }

    String session(UUID id) {
        return sessions.get(id);
    }

    /** Agents that got no slot because {@value #MAX_SLOTS} were already tracked (distinct, bounded). */
    public long overflowed() {
        return overflowed.sum();
    }

    /** Counts now in the slot of this player, for tests; -1 when there is none. */
    int count(UUID id) {
        Slot s = index.get(id);
        return s == null ? -1 : s.count.get();
    }

    private void emitWindow(Ledger l, Slot s, long now) {
        int n = s.count.getAndSet(0);
        long ms = Math.max(0L, (now - s.windowStart) / 1_000_000L);
        s.windowStart = now;
        String session = sessions.get(s.id);
        if (session != null) {
            s.lastSession = session;
        } else {
            session = s.lastSession;
        }
        Attrs at = Attrs.of().str(AttrKeys.LIFE_ID, s.name).lng(AttrKeys.AMOUNT, n).lng(AttrKeys.DURATION_MS, ms);
        if (session != null && !session.isEmpty()) {
            at = at.str(AttrKeys.MC_SESSION, session);
        }
        l.events().emitMap(Names.Events.PLAYER_CLIENT_TICK, Severity.INFO, at.build());
    }

    /** Async task: one event per tracked and per departed agent. Never on the main thread; never throws. */
    void emitCadence() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            CollectorGuard g = guard;
            if (!running || h == null || l == null || g == null || h.isMainThread() || !g.allowed()) {
                return;
            }
            long now = nanos.getAsLong();
            CommandTreeAudit a = audit;
            for (Slot s : index.values()) {
                if (!running) {
                    return;
                }
                try {
                    if (a != null) {
                        a.flush(s, true);
                    }
                    emitWindow(l, s, now);
                } catch (Throwable t) {
                    // one agent never stops the others
                }
            }
            Slot gone;
            while (running && (gone = departed.poll()) != null) {
                try {
                    // a tree still held for a connection that has left is dropped, not flushed
                    emitWindow(l, gone, now);
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

        Handlers(CollectorGuard guard) {
            this.guard = guard;
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onTickEnd(ClientTickEndEvent e) {
            try {
                if (!guard.allowed()) {
                    return;
                }
                long token = guard.begin();
                try {
                    Player p = e.getPlayer();
                    Slot s = index.get(p.getUniqueId());
                    if (s == null) {
                        s = claim(p);
                    }
                    if (s != null) {
                        s.count.incrementAndGet();
                        if (s.pending.get()) {
                            CommandTreeAudit a = audit;
                            if (a != null) {
                                a.flush(s, false);
                            }
                        }
                    }
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
                Slot s = claim(e.getPlayer());
                CommandTreeAudit a = audit;
                if (s != null) {
                    String session = sessions.get(s.id);
                    if (session != null) {
                        s.lastSession = session;
                    }
                }
                if (s != null && a != null) {
                    a.flush(s, false);
                }
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onQuit(PlayerQuitEvent e) {
            try {
                release(e.getPlayer());
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }
}
