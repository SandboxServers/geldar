package dev.geldar.core.proximity;

import dev.geldar.core.EventEnvelope;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import net.kyori.adventure.audience.Audience;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Speech reaches the players whose effective distance is within the clear tier (decision 0199, spec 5.8). Only the
 * raw 32-block gate is evaluated first. The muffled tier removes the words and sends a heard_muffled notice to the
 * listener's agent (its player name is its life id). The speaker keeps their line; the console keeps it too.
 *
 * <p>The async chat thread cannot read blocks, so the judge runs on the server thread: {@link ServerHop} hops there and
 * waits for the result. A hop that fails (timeout, disabled plugin) silences every other player, which is the safe side.
 */
public final class ProximityChatListener implements Listener {
    /** Runs the work on the server thread and returns its result; an empty set when that fails. */
    public interface ServerHop {
        Set<Player> call(Supplier<Set<Player>> work);
    }

    private final ServerHop hop;
    private final LongSupplier ticks;
    private final Function<World, BlockReader> readers;
    private final ChatHearing hearing;
    private final HearingNoticeSink sink;

    public ProximityChatListener(ServerHop hop, LongSupplier ticks, Function<World, BlockReader> readers,
            ChatHearing hearing, HearingNoticeSink sink) {
        this.hop = hop;
        this.ticks = ticks;
        this.readers = readers;
        this.hearing = hearing;
        this.sink = sink;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Player speaker = event.getPlayer();
        List<Player> others = new ArrayList<>();
        for (Audience audience : event.viewers()) {
            if (audience instanceof Player listener && listener != speaker) {
                others.add(listener);
            }
        }
        Set<Player> heard = hop.call(() -> judge(speaker, others));
        event.viewers().removeIf(audience -> audience instanceof Player listener
                && listener != speaker && !heard.contains(listener));
    }

    /** Runs on the server thread: the clear listeners are returned, and the muffled notices are sent. */
    private Set<Player> judge(Player speaker, List<Player> others) {
        Set<Player> clear = new HashSet<>();
        Location from = speaker.getLocation();
        World world = from.getWorld();
        if (world == null) {
            return clear;
        }
        List<ChatHearing.Candidate> candidates = new ArrayList<>();
        Map<String, Player> byName = new HashMap<>();
        for (Player listener : others) {
            Location at = listener.getLocation();
            boolean sameWorld = world.equals(at.getWorld());
            candidates.add(new ChatHearing.Candidate(listener.getName(), sameWorld, at.getX(), at.getY(), at.getZ()));
            byName.put(listener.getName(), listener);
        }
        BlockReader reader = readers.apply(world);
        List<ChatHearing.Verdict> verdicts = hearing.judge(ticks.getAsLong(), speaker.getName(), from.getX(),
                from.getY(), from.getZ(), candidates, reader);
        for (ChatHearing.Verdict verdict : verdicts) {
            Player listener = byName.get(verdict.key());
            if (verdict.tier() == Tier.CLEAR) {
                clear.add(listener);
            } else if (verdict.tier() == Tier.MUFFLED && EventEnvelope.isLifeId(verdict.key())) {
                sink.muffled(verdict.key(), verdict.notice().direction(), verdict.notice().band());
            }
        }
        return clear;
    }
}
