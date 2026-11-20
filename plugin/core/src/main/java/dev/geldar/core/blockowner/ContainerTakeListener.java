package dev.geldar.core.blockowner;

import dev.geldar.core.EventEnvelope;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.provenance.PriorOwner;
import dev.geldar.core.provenance.ProvenanceJson;
import dev.geldar.core.provenance.TakeDiff;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/**
 * Publishes what a player took out of a block-backed container, as the provenance "take" message (AN-51a). A click
 * snapshots the container's item counts and its prior owner; the next tick snapshots the counts again and sends one
 * message per item whose count went down. Paper-only. Inert until AN-50a registers it.
 */
public final class ContainerTakeListener implements Listener {
    /** At most this many sends in one server tick; the rest are dropped and counted. */
    static final int PER_TICK_CAP = 64;

    private final ProvenanceSink sink;
    private final OwnerCache cache;
    private final BooleanSupplier enabled;
    private final LongSupplier tick;
    private final Consumer<Runnable> nextTick;
    private long cappedTick = Long.MIN_VALUE;
    private int sentThisTick;
    private long dropped;

    /** {@code nextTick} runs a task on the next server tick; production passes the Bukkit scheduler. */
    public ContainerTakeListener(ProvenanceSink sink, OwnerCache cache, BooleanSupplier enabled, LongSupplier tick,
            Consumer<Runnable> nextTick) {
        this.sink = sink;
        this.cache = cache;
        this.enabled = enabled;
        this.tick = tick;
        this.nextTick = nextTick;
    }

    /** A click in a container: the top inventory is the container; the bottom one is the player's own. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onClick(InventoryClickEvent event) {
        if (sink == null || !enabled.getAsBoolean()) {
            return;
        }
        if (!(event.getWhoClicked() instanceof Player player)) {
            return;
        }
        Inventory top = event.getView().getTopInventory();
        Location at = top.getLocation();
        if (at == null || at.getWorld() == null) {
            return;
        }
        Pos pos = new Pos(at.getWorld().getName(), at.getBlockX(), at.getBlockY(), at.getBlockZ());
        clicked(player.getName(), pos, counts(top.getContents()), () -> counts(top.getContents()));
    }

    /**
     * Package-private seam: one click on a block-backed container. The prior owner is read now, so an owner that
     * changes before the next tick does not change who is named. Nothing is taken for a name that is not a life id.
     */
    void clicked(String actor, Pos pos, Map<String, Integer> before, Supplier<Map<String, Integer>> after) {
        if (sink == null || !enabled.getAsBoolean() || !EventEnvelope.isLifeId(actor)) {
            return;
        }
        String prior = PriorOwner.of(cache, pos);
        nextTick.accept(() -> settle(actor, pos, prior, before, after.get()));
    }

    /** Package-private seam: the next tick's half of a click. Sends one take per item whose count went down. */
    void settle(String actor, Pos pos, String priorOwner, Map<String, Integer> before, Map<String, Integer> after) {
        if (sink == null || !enabled.getAsBoolean()) {
            return;
        }
        long now = tick.getAsLong();
        for (Map.Entry<String, Integer> take : TakeDiff.taken(before, after).entrySet()) {
            send(pos, actor, priorOwner, take.getKey(), take.getValue(), now);
        }
    }

    private void send(Pos pos, String actor, String priorOwner, String item, int count, long now) {
        if (now != cappedTick) {
            cappedTick = now;
            sentThisTick = 0;
        }
        if (sentThisTick >= PER_TICK_CAP) {
            dropped++;
            return;
        }
        sentThisTick++;
        sink.send(
                "take",
                ProvenanceJson.takeJson(pos.world(), pos.x(), pos.y(), pos.z(), actor, priorOwner, item, count, now));
    }

    /** Takes dropped by the per-tick cap since the server started. */
    long dropped() {
        return dropped;
    }

    /** Item key (without its namespace) to count, over the stacks of a container. Null slots are empty. */
    static Map<String, Integer> counts(ItemStack[] contents) {
        Map<String, Integer> counts = new TreeMap<>();
        if (contents == null) {
            return counts;
        }
        for (ItemStack stack : contents) {
            if (stack != null) {
                counts.merge(stack.getType().getKey().getKey(), stack.getAmount(), Integer::sum);
            }
        }
        return counts;
    }
}
