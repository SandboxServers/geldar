package dev.geldar.core.blockowner;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import java.util.function.LongSupplier;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Publishes a pickup of an item that another player threw, as the provenance "pickup" message. Inert until something
 * registers it: nothing in this plugin does so yet.
 */
public final class PickupProvenanceListener implements Listener {
    /** At most this many sends in one server tick; the rest are dropped and counted. */
    private static final int PER_TICK_CAP = 64;
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();

    private final ProvenanceSink sink;
    private final BooleanSupplier enabled;
    private final LongSupplier tick;
    private final Function<UUID, Player> online;
    private long cappedTick = Long.MIN_VALUE;
    private int sentThisTick;
    private long dropped;

    public PickupProvenanceListener(ProvenanceSink sink, BooleanSupplier enabled, LongSupplier tick,
            Function<UUID, Player> online) {
        this.sink = sink;
        this.enabled = enabled;
        this.tick = tick;
        this.online = online;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent e) {
        if (sink == null || !enabled.getAsBoolean()) {
            return;
        }
        if (!(e.getEntity() instanceof Player picker)) {
            return;
        }
        UUID thrower = e.getItem().getThrower();
        if (thrower == null || thrower.equals(picker.getUniqueId())) {
            return;
        }
        ItemStack stack = e.getItem().getItemStack();
        publish(picker.getWorld().getName(), picker.getName(), picker.getLocation(), thrower,
                stack.getType().getKey().getKey(), stack.getAmount() - e.getRemaining(),
                e.getItem().getTicksLived(), tick.getAsLong());
    }

    /**
     * Applies the per-tick cap, resolves the thrower and sends the message. Package-private so the tests can drive it
     * without an ItemStack, which cannot be built outside a server.
     */
    void publish(String world, String picker, Location pickerAt, UUID throwerId, String itemKey, int count,
            int ageTicks, long now) {
        if (now != cappedTick) {
            cappedTick = now;
            sentThisTick = 0;
        }
        if (sentThisTick >= PER_TICK_CAP) {
            dropped++;
            return;
        }
        sentThisTick++;

        Player throwerPlayer = online.apply(throwerId);
        String throwerName = throwerPlayer == null ? null : throwerPlayer.getName();
        Double distance = null;
        if (throwerPlayer != null && throwerPlayer.getWorld().getName().equals(world)) {
            double dx = throwerPlayer.getLocation().getX() - pickerAt.getX();
            double dz = throwerPlayer.getLocation().getZ() - pickerAt.getZ();
            distance = Math.hypot(dx, dz);
        }
        sink.send("pickup", pickupJson(world, picker, throwerName, itemKey, count, ageTicks, distance, now));
    }

    /** Pickups dropped by the per-tick cap since the server started. */
    long dropped() {
        return dropped;
    }

    /** The nine keys of a pickup message; a missing name or distance is written as JSON null. */
    static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks,
            Double distance, long tick) {
        JsonObject o = new JsonObject();
        o.addProperty("kind", "pickup");
        o.addProperty("world", world);
        o.addProperty("picker", picker);
        o.addProperty("thrower", thrower);
        o.addProperty("item", item);
        o.addProperty("count", count);
        o.addProperty("age_ticks", ageTicks);
        o.addProperty("distance", distance);
        o.addProperty("tick", tick);
        return GSON.toJson(o);
    }
}
