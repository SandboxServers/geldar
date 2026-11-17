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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicIntegerArray;
import java.util.concurrent.atomic.AtomicReferenceArray;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
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
 * count and no event. The UUID is a map key only and is never exported. Both events carry the join's {@code mc_session}
 * when {@link SessionIds#shared()} knows it.
 *
 * <p>Client tick. {@link ClientTickEndEvent} handler does one map read and one atomic increment on a preallocated slot
 * array ({@value #MAX_SLOTS} slots, no allocation per event). An async task every {@value #CADENCE_MS} ms reads and
 * resets each slot and emits one {@code geldar.player.client_tick} per agent, a zero included (a stalled client is the
 * point). Whether a given client sends the tick-end packet is unverified: a zero count is a finding, not a failure.
 *
 * <p>Command tree. See {@link CommandTreeAudit}: once per connection, count and hash only.
 */
public final class ClientCadenceCollector implements Collector {
    public static final String ID = "cadence";
    public static final long CADENCE_MS = 60_000L;
    static final int MAX_SLOTS = 256;

    private final Consumer<Listener> registry;
    private final Supplier<Collection<? extends Player>> online;
    private final SessionIds sessions;
    private final LongSupplier nanos;

    private final ConcurrentHashMap<UUID, Integer> index = new ConcurrentHashMap<>();
    private final AtomicIntegerArray counts = new AtomicIntegerArray(MAX_SLOTS);
    private final AtomicIntegerArray treeSent = new AtomicIntegerArray(MAX_SLOTS);
    private final AtomicReferenceArray<String> names = new AtomicReferenceArray<>(MAX_SLOTS);
    private final AtomicReferenceArray<UUID> uuids = new AtomicReferenceArray<>(MAX_SLOTS);
    private final Object slotLock = new Object();

    private Listener tickListener;
    private Listener treeListener;
    private Cancellable task;
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
        CommandTreeAudit audit = new CommandTreeAudit(guard, ev, treeId, this, nanos);
        tickListener = h;
        treeListener = audit;
        registry.accept(h);
        registry.accept(audit);
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
        synchronized (slotLock) {
            index.clear();
            for (int i = 0; i < MAX_SLOTS; i++) {
                clearSlot(i);
            }
        }
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

    private void clearSlot(int i) {
        counts.set(i, 0);
        treeSent.set(i, 0);
        names.set(i, null);
        uuids.set(i, null);
    }

    private void seed() {
        try {
            for (Player p : online.get()) {
                slot(p.getUniqueId(), p.getName());
            }
        } catch (Throwable t) {
            // the join handler still fills the slots
        }
    }

    /** The slot of an agent, claimed on first sight; -1 for a human or when every slot is taken. */
    int slot(UUID id, String name) {
        Integer have = index.get(id);
        if (have != null) {
            return have;
        }
        if (!LifeIds.isLifeId(name)) {
            return -1;
        }
        synchronized (slotLock) {
            have = index.get(id);
            if (have != null) {
                return have;
            }
            for (int i = 0; i < MAX_SLOTS; i++) {
                if (names.get(i) == null) {
                    clearSlot(i);
                    uuids.set(i, id);
                    names.set(i, name);
                    index.put(id, i);
                    return i;
                }
            }
            return -1;
        }
    }

    private void release(UUID id) {
        synchronized (slotLock) {
            Integer i = index.remove(id);
            if (i != null) {
                clearSlot(i);
            }
        }
    }

    boolean treePending(UUID id, String name) {
        int i = slot(id, name);
        return i >= 0 && treeSent.get(i) == 0;
    }

    void treeDone(UUID id) {
        Integer i = index.get(id);
        if (i != null) {
            treeSent.set(i, 1);
        }
    }

    String session(UUID id) {
        return sessions.get(id);
    }

    /** Counts now in the slot of this player, for tests. */
    int count(UUID id) {
        Integer i = index.get(id);
        return i == null ? -1 : counts.get(i);
    }

    /** Async task: one event per tracked agent, count read and reset together. Never on the main thread; never throws. */
    void emitCadence() {
        try {
            HostInfo h = host;
            Ledger l = ledger;
            CollectorGuard g = guard;
            if (!running || h == null || l == null || g == null || h.isMainThread() || !g.allowed()) {
                return;
            }
            for (int i = 0; i < MAX_SLOTS && running; i++) {
                try {
                    String name = names.get(i);
                    UUID id = uuids.get(i);
                    if (name == null || id == null) {
                        continue;
                    }
                    int n = counts.getAndSet(i, 0);
                    String session = sessions.get(id);
                    Attrs at = Attrs.of().str(AttrKeys.LIFE_ID, name).lng(AttrKeys.AMOUNT, n);
                    if (session != null && !session.isEmpty()) {
                        at = at.str(AttrKeys.MC_SESSION, session);
                    }
                    l.events().emitMap(Names.Events.PLAYER_CLIENT_TICK, Severity.INFO, at.build());
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
                    Integer i = index.get(e.getPlayer().getUniqueId());
                    if (i != null) {
                        counts.incrementAndGet(i);
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
                Player p = e.getPlayer();
                slot(p.getUniqueId(), p.getName());
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onQuit(PlayerQuitEvent e) {
            try {
                release(e.getPlayer().getUniqueId());
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }
}
