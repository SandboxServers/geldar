package dev.geldar.ledger.neoforge.curated;

import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.block.BreakBlockEvent;

/**
 * Blocks and items (VERIFIED events only): break, place, craft, smelt. Each lambda only hands the event to the
 * collector, which takes its bucket first and reads afterwards.
 */
final class BlocksItemsFamily {
    private BlocksItemsFamily() {}

    static void register(Bus bus, CuratedCollector c, Readers r) {
        bus.listen(BreakBlockEvent.class, e -> c.handle(CuratedKind.BREAK, () -> r.breakBlock(e)));
        bus.listen(BlockEvent.EntityPlaceEvent.class, e -> c.handle(CuratedKind.PLACE, () -> r.place(e)));
        bus.listen(PlayerEvent.ItemCraftedEvent.class, e -> c.handle(CuratedKind.CRAFT, () -> r.craft(e)));
        bus.listen(PlayerEvent.ItemSmeltedEvent.class, e -> c.handle(CuratedKind.SMELT, () -> r.smelt(e)));
    }
}
