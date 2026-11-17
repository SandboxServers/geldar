package dev.geldar.ledger.neoforge.curated;

import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.block.BreakBlockEvent;

/**
 * The only code that reads Minecraft objects for PT-N7. Each method returns null for an event to ignore (client side,
 * not a player). It may throw: {@link CuratedCollector} counts and swallows that. The test seam of the family lambdas.
 */
interface Readers {
    CuratedFields breakBlock(BreakBlockEvent e);

    CuratedFields place(BlockEvent.EntityPlaceEvent e);

    CuratedFields craft(PlayerEvent.ItemCraftedEvent e);

    CuratedFields smelt(PlayerEvent.ItemSmeltedEvent e);

    CuratedFields open(PlayerContainerEvent.Open e);

    CuratedFields close(PlayerContainerEvent.Close e);
}
