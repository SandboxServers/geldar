package dev.geldar.ledger.paper.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import dev.geldar.ledger.paper.LedgerPlugin;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.IntSupplier;
import java.util.function.LongSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * {@code geldar.player.prelogin|join|quit|kick} and the per-connection {@code mc_session} (PT-08a). Observe only: every
 * handler is MONITOR, reads the event and never changes it.
 *
 * <p>Identity. The only name an event carries is the {@code life_id}, and only when the login name has the life id shape;
 * the binding derives the player UUID attribute from it. Any other name, every raw UUID and every address stay out: the
 * UUID is only a key inside {@link SessionIds}. {@code mc_session} is a fresh ULID minted at join (not derived from
 * anything). A kick reason is exported only when it is at most 200 characters, with the player's own name replaced, then
 * scrubbed and capped.
 *
 * <p>Threading. The pre-login event is asynchronous: its handler touches no guard timing, only the thread-safe event ring.
 * Join, quit and kick run on the main thread inside the guard.
 */
public final class ConnectionCollector implements Collector {
    public static final String ID = "connections";
    public static final int MAX_REASON_CHARS = 200;
    private static final int REASON_MAX_BYTES = 1024;
    private static final int RATE_PER_SECOND = 20;
    private static final String PLAYER_MASK = "[player]";

    private final Consumer<Listener> registry;
    private final IntSupplier online;
    private final LongSupplier clockMs;
    private final SessionIds sessions;
    private Listener listener;

    /** Production constructor, used by reflection from the collector factory. Touches nothing of the server. */
    public ConnectionCollector() {
        this(
                l -> JavaPlugin.getPlugin(LedgerPlugin.class).listeners().register(l),
                () -> Bukkit.getServer().getOnlinePlayers().size(),
                System::currentTimeMillis,
                new SessionIds());
    }

    ConnectionCollector(Consumer<Listener> registry, IntSupplier online, LongSupplier clockMs, SessionIds sessions) {
        this.registry = registry;
        this.online = online;
        this.clockMs = clockMs;
        this.sessions = sessions;
    }

    @Override
    public String id() {
        return ID;
    }

    /** The read-only accessor for the later player collectors. */
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
        EventLog ev = l.events();
        int pre = ev.register(
                Names.Events.PLAYER_PRELOGIN, Severity.INFO, RATE_PER_SECOND,
                null, null, null, AttrKeys.LIFE_ID, AttrKeys.RESULT, null);
        int join = ev.register(
                Names.Events.PLAYER_JOIN, Severity.INFO, RATE_PER_SECOND,
                AttrKeys.AMOUNT, null, null, AttrKeys.LIFE_ID, AttrKeys.MC_SESSION, null);
        int quit = ev.register(
                Names.Events.PLAYER_QUIT, Severity.INFO, RATE_PER_SECOND,
                AttrKeys.DURATION_MS, null, null, AttrKeys.LIFE_ID, AttrKeys.MC_SESSION, AttrKeys.CAUSE);
        int kick = ev.register(
                Names.Events.PLAYER_KICK, Severity.INFO, RATE_PER_SECOND,
                null, null, null, AttrKeys.LIFE_ID, AttrKeys.CAUSE, AttrKeys.MC_SESSION);
        Handlers h = new Handlers(l.guard(ID), ev, pre, join, quit, kick);
        listener = h;
        registry.accept(h);
    }

    @Override
    public synchronized void stop() {
        Listener l = listener;
        listener = null;
        try {
            if (l != null) {
                HandlerList.unregisterAll(l);
            }
        } catch (Throwable t) {
            // idempotent, best effort
        }
        sessions.clear();
    }

    /** The life id when the name has that shape, else the empty string (the slot is then not exported). */
    static String lifeId(String name) {
        return LifeIds.isLifeId(name) ? name : "";
    }

    /**
     * The kick reason as exported: empty when absent or longer than {@value #MAX_REASON_CHARS} characters; otherwise the
     * player's own name is masked, then the text is scrubbed and capped.
     */
    static String reasonText(String raw, String playerName) {
        if (raw == null || raw.isEmpty() || raw.length() > MAX_REASON_CHARS) {
            return "";
        }
        String text = raw;
        if (playerName != null && !playerName.isEmpty()) {
            text = Pattern.compile(Pattern.quote(playerName), Pattern.CASE_INSENSITIVE)
                    .matcher(text)
                    .replaceAll(Matcher.quoteReplacement(PLAYER_MASK));
        }
        return ContentCap.cap(Redactor.scrub(text), REASON_MAX_BYTES);
    }

    final class Handlers implements Listener {
        private final CollectorGuard guard;
        private final EventLog events;
        private final int preId;
        private final int joinId;
        private final int quitId;
        private final int kickId;

        Handlers(CollectorGuard guard, EventLog events, int preId, int joinId, int quitId, int kickId) {
            this.guard = guard;
            this.events = events;
            this.preId = preId;
            this.joinId = joinId;
            this.quitId = quitId;
            this.kickId = kickId;
        }

        /** Asynchronous: no guard timing here (the guard keeps main-thread-only state), only the thread-safe ring. */
        @EventHandler(priority = EventPriority.MONITOR)
        public void onPreLogin(AsyncPlayerPreLoginEvent e) {
            try {
                if (!guard.allowed()) {
                    return;
                }
                AsyncPlayerPreLoginEvent.Result result = e.getLoginResult();
                events.record(preId, 0, 0, 0, lifeId(e.getName()), result == null ? "" : result.name(), "");
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onJoin(PlayerJoinEvent e) {
            try {
                if (!guard.allowed()) {
                    return;
                }
                long token = guard.begin();
                try {
                    Player p = e.getPlayer();
                    String session = sessions.open(p.getUniqueId(), clockMs.getAsLong());
                    events.record(joinId, online.getAsInt(), 0, 0, lifeId(p.getName()), session, "");
                } finally {
                    guard.end(token);
                }
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        @EventHandler(priority = EventPriority.MONITOR)
        public void onQuit(PlayerQuitEvent e) {
            try {
                if (!guard.allowed()) {
                    // still release the entry so the map cannot grow while the collector is shut off
                    sessions.close(e.getPlayer().getUniqueId());
                    return;
                }
                long token = guard.begin();
                try {
                    Player p = e.getPlayer();
                    SessionIds.Session s = sessions.close(p.getUniqueId());
                    long duration = s == null ? 0 : Math.max(0, clockMs.getAsLong() - s.openedMs());
                    PlayerQuitEvent.QuitReason reason = e.getReason();
                    events.record(
                            quitId,
                            duration,
                            0,
                            0,
                            lifeId(p.getName()),
                            s == null ? "" : s.id(),
                            reason == null ? "" : reason.name());
                } finally {
                    guard.end(token);
                }
            } catch (Throwable t) {
                // never throw into the host
            }
        }

        /** A kick that another plugin cancelled is not a kick, so cancelled events are skipped. */
        @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
        public void onKick(PlayerKickEvent e) {
            try {
                if (!guard.allowed()) {
                    return;
                }
                long token = guard.begin();
                try {
                    Player p = e.getPlayer();
                    UUID id = p.getUniqueId();
                    String name = p.getName();
                    Component reason = e.reason();
                    String plain = reason == null ? null : PlainTextComponentSerializer.plainText().serialize(reason);
                    String session = sessions.get(id);
                    events.record(
                            kickId, 0, 0, 0, lifeId(name), reasonText(plain, name), session == null ? "" : session);
                } finally {
                    guard.end(token);
                }
            } catch (Throwable t) {
                // never throw into the host
            }
        }
    }
}
