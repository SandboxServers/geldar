package dev.geldar.core.blockowner;

import dev.geldar.core.EventEnvelope;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.provenance.PriorOwner;
import dev.geldar.core.provenance.ProvenanceJson;
import dev.geldar.core.provenance.TakeDiff;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.bukkit.Location;
import org.bukkit.block.Container;
import org.bukkit.block.DoubleChest;
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
    /** The largest count the provenance schema accepts (TakeProvenance.count). */
    static final int MAX_TAKE_COUNT = 2304;

    private final ProvenanceSink sink;
    private final OwnerCache cache;
    private final BooleanSupplier enabled;
    private final LongSupplier tick;
    private final Consumer<Runnable> nextTick;
    /** One pending settle per actor and position: the first click of a tick keeps its counts and owner. */
    private final Map<String, Pending> pending = new HashMap<>();
    private long cappedTick = Long.MIN_VALUE;
    private int sentThisTick;
    private long dropped;

    /** A click's snapshot taken before the click, and the prior owner read at the click. */
    private record Pending(String priorOwner, Map<String, Integer> before) {}

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
        Inventory top = event.getView().getTopInventory();
        Location at = top.getLocation();
        boolean located = at != null && at.getWorld() != null;
        if (!isTakeSource(event.getWhoClicked() instanceof Player, located, isStorage(top.getHolder()))) {
            return;
        }
        Pos pos = new Pos(at.getWorld().getName(), at.getBlockX(), at.getBlockY(), at.getBlockZ());
        clicked(event.getWhoClicked().getName(), pos, counts(top.getContents()), () -> counts(top.getContents()));
    }

    /**
     * Package-private seam: one click on a block-backed container. The prior owner is read now, so an owner that
     * changes before the next tick does not change who is named. Nothing is taken for a name that is not a life id.
     * A second click by the same actor on the same position before the next tick adds nothing: the first click's
     * counts stand, so several clicks in one tick cannot count the same removal twice.
     */
    void clicked(String actor, Pos pos, Map<String, Integer> before, Supplier<Map<String, Integer>> after) {
        if (sink == null || !enabled.getAsBoolean() || !EventEnvelope.isLifeId(actor)) {
            return;
        }
        String key = key(actor, pos);
        if (pending.containsKey(key)) {
            return;
        }
        pending.put(key, new Pending(PriorOwner.of(cache, pos), before));
        try {
            nextTick.accept(() -> settleKey(key, actor, pos, after));
        } catch (RuntimeException e) {
            pending.remove(key);
            throw e;
        }
    }

    private void settleKey(String key, String actor, Pos pos, Supplier<Map<String, Integer>> after) {
        Pending click = pending.remove(key);
        if (click != null) {
            settle(actor, pos, click.priorOwner(), click.before(), after.get());
        }
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
                ProvenanceJson.takeJson(
                        pos.world(),
                        pos.x(),
                        pos.y(),
                        pos.z(),
                        actor,
                        priorOwner,
                        item,
                        Math.min(count, MAX_TAKE_COUNT),
                        now));
    }

    /** Takes dropped by the per-tick cap since the server started. */
    long dropped() {
        return dropped;
    }

    /**
     * Package-private seam for the click's decision: a take is recorded only for a player clicking a located storage
     * holder (a chest, a barrel, a double chest, or another container block).
     */
    static boolean isTakeSource(boolean player, boolean located, boolean storage) {
        return player && located && storage;
    }

    /** True for a storage holder: a container block or a double chest. Other block menus are not takes. */
    static boolean isStorage(Object holder) {
        return holder != null && isStorageType(holder.getClass());
    }

    /** Package-private seam: whether a holder's class is a container block or a double chest. */
    static boolean isStorageType(Class<?> holderType) {
        return Container.class.isAssignableFrom(holderType) || DoubleChest.class.isAssignableFrom(holderType);
    }

    /** Item key (without its namespace) to count, over the stacks of a container. Null slots are empty. */
    static Map<String, Integer> counts(ItemStack[] contents) {
        List<Map.Entry<String, Integer>> stacks = new ArrayList<>();
        if (contents != null) {
            for (ItemStack stack : contents) {
                if (stack != null) {
                    stacks.add(Map.entry(stack.getType().getKey().getKey(), stack.getAmount()));
                }
            }
        }
        return countsOf(stacks);
    }

    /** Sums (item key, amount) stacks into counts: two stacks of one item add up. */
    static Map<String, Integer> countsOf(List<Map.Entry<String, Integer>> stacks) {
        Map<String, Integer> counts = new TreeMap<>();
        for (Map.Entry<String, Integer> stack : stacks) {
            counts.merge(stack.getKey(), stack.getValue(), Integer::sum);
        }
        return counts;
    }

    private static String key(String actor, Pos pos) {
        return actor + "|" + pos.world() + "|" + pos.x() + "|" + pos.y() + "|" + pos.z();
    }
}
