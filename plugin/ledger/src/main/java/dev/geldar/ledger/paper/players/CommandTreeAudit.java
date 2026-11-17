package dev.geldar.ledger.paper.players;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import java.util.Arrays;
import java.util.Collection;
import java.util.function.LongSupplier;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandSendEvent;

/**
 * {@code geldar.player.command_tree} (PT-08d): how many commands a player's client is told about, and a hash of the
 * sorted names, once per connection. The audit shows that agents see no operator commands. It only reads the collection:
 * it never removes from it, clears it or replaces it (the tree the player sees is not ours to change), and the command
 * names are never recorded, only the count and the hash.
 *
 * <p>Order of work, cheapest first: guard, life id shape, once-per-connection flag, a per-second cap, and only then the
 * sort. Main thread; MONITOR priority.
 */
final class CommandTreeAudit implements Listener {
    static final int PER_SECOND = 20;
    static final int MAX_COMMANDS = 20_000;
    private static final long SECOND_NANOS = 1_000_000_000L;

    private final CollectorGuard guard;
    private final EventLog events;
    private final int id;
    private final ClientCadenceCollector owner;
    private final LongSupplier nanos;
    private long windowStart;
    private int used;
    private boolean started;

    CommandTreeAudit(CollectorGuard guard, EventLog events, int id, ClientCadenceCollector owner, LongSupplier nanos) {
        this.guard = guard;
        this.events = events;
        this.id = id;
        this.owner = owner;
        this.nanos = nanos;
    }

    static int register(EventLog events) {
        return events.register(
                Names.Events.PLAYER_COMMAND_TREE, Severity.INFO, PER_SECOND,
                AttrKeys.AMOUNT, null, null, AttrKeys.LIFE_ID, AttrKeys.MC_SESSION, AttrKeys.SUBTYPE);
    }

    /** The hash of the sorted names, as 8 lower-case hex digits. Sorting is on a copy; the argument is not touched. */
    static String hash(String[] names) {
        String[] copy = names.clone();
        Arrays.sort(copy);
        return String.format("%08x", Arrays.hashCode(copy));
    }

    private boolean underCap() {
        long now = nanos.getAsLong();
        if (!started || now - windowStart >= SECOND_NANOS) {
            started = true;
            windowStart = now;
            used = 0;
        }
        if (used >= PER_SECOND) {
            return false;
        }
        used++;
        return true;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onCommandSend(PlayerCommandSendEvent e) {
        try {
            if (!guard.allowed()) {
                return;
            }
            long token = guard.begin();
            try {
                Player p = e.getPlayer();
                String name = p.getName();
                if (!LifeIds.isLifeId(name) || !owner.treePending(p.getUniqueId(), name) || !underCap()) {
                    return;
                }
                owner.treeDone(p.getUniqueId());
                Collection<String> commands = e.getCommands();
                int size = commands.size();
                String hash = size > MAX_COMMANDS ? "" : hash(commands.toArray(new String[0]));
                String session = owner.session(p.getUniqueId());
                events.record(id, size, 0, 0, name, session == null ? "" : session, hash);
            } finally {
                guard.end(token);
            }
        } catch (Throwable t) {
            // never throw into the host
        }
    }
}
