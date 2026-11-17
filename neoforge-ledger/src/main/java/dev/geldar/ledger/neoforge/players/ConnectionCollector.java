package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Attrs;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
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
    private volatile Ledger ledger;
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
        ledger = l;
        guard = l.guard(ID);
    }

    @Override
    public synchronized void stop() {
        ledger = null;
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
            Ledger l = ledger;
            CollectorGuard g = guard;
            if (l == null || g == null || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                String life = lifeId(name);
                String session = life == null ? null : sessions.open(connection, clockMs.getAsLong());
                l.events().emitMap(Names.Events.PLAYER_JOIN, Severity.INFO, joinAttrs(life, session, online));
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
            SessionIds.Session s = sessions.close(connection);
            Ledger l = ledger;
            CollectorGuard g = guard;
            if (l == null || g == null || !g.allowed()) {
                return;
            }
            long token = g.begin();
            try {
                long duration = s == null ? 0 : Math.max(0, clockMs.getAsLong() - s.openedMs());
                l.events().emitMap(
                        Names.Events.PLAYER_QUIT, Severity.INFO, quitAttrs(lifeId(name), s == null ? null : s.id(), duration));
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

    static java.util.Map<String, Object> joinAttrs(String life, String session, int online) {
        Attrs a = Attrs.of().lng(AttrKeys.AMOUNT, online);
        return identity(a, life, session).build();
    }

    static java.util.Map<String, Object> quitAttrs(String life, String session, long durationMs) {
        Attrs a = Attrs.of().lng(AttrKeys.DURATION_MS, durationMs);
        return identity(a, life, session).build();
    }

    private static Attrs identity(Attrs a, String life, String session) {
        Attrs r = a;
        if (life != null) {
            r = r.str(AttrKeys.LIFE_ID, life);
        }
        if (session != null) {
            r = r.str(AttrKeys.MC_SESSION, session);
        }
        return r;
    }
}
