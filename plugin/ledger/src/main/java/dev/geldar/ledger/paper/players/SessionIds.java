package dev.geldar.ledger.paper.players;

import dev.geldar.ledger.core.ids.Ulid;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/**
 * The open connections: a player's UUID (a map key only, never exported) to a per-connection ULID, the {@code mc_session}.
 * Every join mints a fresh id; the id is not derived from the name, the UUID or an address, so it names one connection and
 * nothing else. The map is bounded: when it is full a new connection still gets an id, but it is not remembered
 * ({@link #overflowed()} counts them), so a leak or a flood cannot grow it. Thread safe; later player cards read it through
 * {@link #get}.
 */
public final class SessionIds {
    public static final int DEFAULT_CAP = 4096;

    /** An open connection: its id and the time it opened, in epoch milliseconds. */
    public record Session(String id, long openedMs) {}

    private final ConcurrentHashMap<UUID, Session> open = new ConcurrentHashMap<>();
    private final AtomicLong overflowed = new AtomicLong();
    private final int cap;
    private final Supplier<String> ids;

    public SessionIds() {
        this(DEFAULT_CAP, Ulid::next);
    }

    SessionIds(int cap, Supplier<String> ids) {
        this.cap = cap;
        this.ids = ids;
    }

    /** Opens a session for this player and returns its id; a session still open for the same player is replaced. */
    public String open(UUID player, long nowMs) {
        String id = ids.get();
        if (open.size() >= cap && !open.containsKey(player)) {
            overflowed.incrementAndGet();
            return id;
        }
        open.put(player, new Session(id, nowMs));
        return id;
    }

    /** The id of the player's open session, or null. */
    public String get(UUID player) {
        Session s = open.get(player);
        return s == null ? null : s.id();
    }

    /** The open session (id and start time), or null. */
    public Session session(UUID player) {
        return open.get(player);
    }

    /** Removes and returns the player's session, or null when none is open. */
    public Session close(UUID player) {
        return open.remove(player);
    }

    public int size() {
        return open.size();
    }

    public void clear() {
        open.clear();
    }

    /** Sessions that were handed an id but not stored because the map was full. */
    public long overflowed() {
        return overflowed.get();
    }
}
