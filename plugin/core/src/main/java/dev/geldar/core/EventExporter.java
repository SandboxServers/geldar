package dev.geldar.core;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;

/**
 * Turns Phase 0 world events (damage, death, sleep, server_tps) into envelopes and hands them to the
 * publisher. Nothing here may throw into the server thread: every failure is logged and swallowed.
 */
public final class EventExporter implements Listener {
    private final EventPublisher publisher;
    private final String shard;
    private final LongSupplier worldTick;
    private final Supplier<Instant> clock;
    private final Logger log;

    /** Creates the exporter; {@code worldTick} and {@code clock} are injected so tests need no server. */
    public EventExporter(
            EventPublisher publisher, String shard, LongSupplier worldTick, Supplier<Instant> clock, Logger log) {
        this.publisher = publisher;
        this.shard = shard;
        this.worldTick = worldTick;
        this.clock = clock;
        this.log = log;
    }

    /** Builds and publishes one event. {@code playerName} becomes {@code agent_id} when it is a life id. */
    public void emit(String type, String playerName, JsonObject payload) {
        try {
            if (playerName != null) {
                payload.addProperty("player", playerName);
            }
            String agentId = EventEnvelope.isLifeId(playerName) ? playerName : null;
            publisher.publish(EventEnvelope.create(clock.get(), shard, worldTick.getAsLong(), type, agentId, payload));
        } catch (RuntimeException e) {
            log.log(Level.WARNING, "Could not export " + type + " event", e);
        }
    }

    /**
     * Called by the scheduler every 20 s with the one-minute-window TPS figure. The payload also tells
     * how many events the publisher has dropped and whether it is connected, so a silent outage shows.
     */
    public void exportTps(double tps, int players) {
        JsonObject p = new JsonObject();
        p.addProperty("tps", tps);
        p.addProperty("players", players);
        p.addProperty("dropped", publisher.dropped());
        p.addProperty("connected", publisher.connected());
        emit("server_tps", null, p);
    }

    /** Exports damage a player took, once all other plugins have settled the event. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) {
            return;
        }
        JsonObject p = new JsonObject();
        p.addProperty("cause", event.getCause().name());
        p.addProperty("amount", event.getFinalDamage());
        emit("damage", player.getName(), p);
    }

    /** Exports a player death with the last damage cause. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        JsonObject p = new JsonObject();
        EntityDamageEvent last = player.getLastDamageCause();
        p.addProperty("cause", last == null ? "UNKNOWN" : last.getCause().name());
        emit("death", player.getName(), p);
    }

    /** Exports a player getting into a bed; refused attempts (monsters near, wrong time) are not sleep. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onSleep(PlayerBedEnterEvent event) {
        if (event.getBedEnterResult() != PlayerBedEnterEvent.BedEnterResult.OK) {
            return;
        }
        emit("sleep", event.getPlayer().getName(), new JsonObject());
    }
}