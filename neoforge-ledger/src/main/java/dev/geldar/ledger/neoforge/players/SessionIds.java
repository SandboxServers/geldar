package dev.geldar.ledger.neoforge.players;

import dev.geldar.ledger.core.ids.Ulid;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * The open connections: the connection's player object (a key only, compared by identity, never exported) to a
 * per-connection ULID, the {@code mc_session}. Every join mints a fresh id that is not derived from the name, a UUID or an
 * address. Keying by the object, not by name or UUID, means a late quit of an old connection can only remove its own
 * session, never the one of a reconnected agent with the same name. Bounded: when full a new connection still gets an id
 * but is not remembered ({@link #overflowed()} counts them). Thread safe.
 */
public final class SessionIds {
    public static final int DEFAULT_CAP = 4096;

    /** An open connection: its id and the time it opened, in epoch milliseconds. */
    public record Session(String id, long openedMs) {}

    private final Map<Object, Session> open = new IdentityHashMap<>();
    private final int cap;
    private final Supplier<String> ids;
    private long overflowed;

    public SessionIds() {
        this(DEFAULT_CAP, Ulid::next);
    }

    SessionIds(int cap, Supplier<String> ids) {
        this.cap = cap;
        this.ids = ids;
    }

    private static final class Holder {
        static final SessionIds SHARED = new SessionIds();
    }

    /** The process-wide instance, shared by the connection collector and the collectors that export {@code mc_session}. */
    public static SessionIds shared() {
        return Holder.SHARED;
    }

    /** Opens a session for this connection and returns its id; one still open for the same object is replaced. */
    public synchronized String open(Object connection, long nowMs) {
        String id = ids.get();
        if (open.size() >= cap && !open.containsKey(connection)) {
            overflowed++;
            return id;
        }
        open.put(connection, new Session(id, nowMs));
        return id;
    }

    /** The id of the connection's open session, or null. */
    public synchronized String get(Object connection) {
        Session s = open.get(connection);
        return s == null ? null : s.id();
    }

    /** Removes and returns the connection's session, or null when none is open. */
    public synchronized Session close(Object connection) {
        return open.remove(connection);
    }

    public synchronized int size() {
        return open.size();
    }

    public synchronized void clear() {
        open.clear();
    }

    public synchronized long overflowed() {
        return overflowed;
    }
}
