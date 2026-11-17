package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.function.LongSupplier;

/**
 * {@code geldar.player.join|quit} and the per-connection {@code mc_session} (PT-N6), Paper parity minus prelogin, kick and
 * the quit cause: NeoForge has no verified event for them (gap: nothing is emitted for a kick reason).
 *
 * <p>Identity. Only a name with the life id shape is an agent: it gets {@code life_id} and a session. A human gets neither
 * (no name, no UUID, no address, no session); the join and quit still count the roster size through the
 * {@code amount} of the join, as on Paper. No UUID is read: behind Velocity the offline UUID is a pure function of the
 * name, so it is reversible by dictionary and never exported. The key of a session is the player object.
 *
 * <p>Threading. Join and quit run on the main thread inside the guard; nothing here is async. Enabled by default (as on
 * Paper) unless the master switch or {@code collector.connections.enabled=false} turns it off.
 */
public final class ConnectionCollector implements Collector {
    public static final String ID = "connections";

    private final LongSupplier clockMs;
    private final SessionIds sessions;
    static final int RATE_PER_SECOND = 20;

    private volatile EventLog events;
    private volatile int joinId;
    private volatile int quitId;
    private volatile CollectorGuard guard;

    public ConnectionCollector() {
        this(System::currentTimeMillis, SessionIds.shared());
    }

    ConnectionCollector(LongSupplier clockMs, SessionIds sessions) {
        this.clockMs = clockMs;
        this.sessions = sessions;
    }

    @Override
    public String id() {
        return ID;
    }

    public SessionIds sessions() {
        return sessions;
    }

    @Override
    public synchronized void start(CollectorContext ctx) {
        stop();
        Ledger l = ctx.ledger();
        if (!l.config().collectorEnabled(ID)) {
            return;
        }
        // Field names are positional: three longs, then three strings (a null skips a slot). record() is main-thread safe;
        // emitMap is not (the ledger drops it on the main thread).
        EventLog ev = l.events();
        joinId = ev.register(
                Names.Events.PLAYER_JOIN, Severity.INFO, RATE_PER_SECOND,
                AttrKeys.AMOUNT, null, null, AttrKeys.LIFE_ID, AttrKeys.MC_SESSION, null);
        quitId = ev.register(
                Names.Events.PLAYER_QUIT, Severity.INFO, RATE_PER_SECOND,
                AttrKeys.DURATION_MS, null, null, AttrKeys.LIFE_ID, AttrKeys.MC_SESSION, null);
        events = ev;
        guard = l.guard(ID);
    }

    @Override
    public synchronized void stop() {
        events = null;
        guard = null;
        sessions.clear();
    }

    /** The life id when the name has that shape, else null (the slot is then not exported). */
    static String lifeId(String name) {
        return LifeIds.isLifeId(name) ? name : null;
    }

    /** A connection joined (main thread). {@code online} is the roster size. Never throws. */
    public void join(Object connection, String name, int online) {
        try {
            EventLog ev = events;
            CollectorGuard g = guard;
            if (ev == null || g == null || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                String life = lifeId(name);
                String session = life == null || connection == null ? null : sessions.open(connection, clockMs.getAsLong());
                ev.record(joinId, online, 0, 0, orEmpty(life), orEmpty(session), "");
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            // never throw into the host
        }
    }

    /** A connection left (main thread). Closes only this object's session, even while the collector is shut off. */
    public void quit(Object connection, String name) {
        try {
            SessionIds.Session s = connection == null ? null : sessions.close(connection);
            EventLog ev = events;
            CollectorGuard g = guard;
            if (ev == null || g == null || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                long duration = s == null ? 0 : Math.max(0, clockMs.getAsLong() - s.openedMs());
                ev.record(quitId, duration, 0, 0, orEmpty(lifeId(name)), orEmpty(s == null ? null : s.id()), "");
            } finally {
                g.end(token);
            }
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            // never throw into the host
        }
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
