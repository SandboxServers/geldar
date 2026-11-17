package dev.geldar.ledger.neoforge.curated;

import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.block.BreakBlockEvent;

/**
 * Production {@link Readers}. Reads only ids, positions and the player's name; never item components, names, contents
 * or text. Ids come from the block and item's own holder key, not a registry scan. Item events carry the acting
 * player's block position, as on Paper.
 */
final class McReaders implements Readers {
    private static final int NAME_CAP = 48;

    @Override
    public CuratedFields breakBlock(BreakBlockEvent e) {
        if (e.getLevel().isClientSide()) { // fires on both sides
            return null;
        }
        return atBlock(e.getLevel(), e.getPos(), e.getPlayer(), blockId(e.getState()), e.isCanceled());
    }

    @Override
    public CuratedFields place(BlockEvent.EntityPlaceEvent e) {
        if (e.getLevel().isClientSide() || !(e.getEntity() instanceof Player p)) {
            return null;
        }
        return atBlock(e.getLevel(), e.getPos(), p, blockId(e.getPlacedBlock()), e.isCanceled());
    }

    @Override
    public CuratedFields craft(PlayerEvent.ItemCraftedEvent e) {
        return atPlayer(e.getEntity(), itemId(e.getCrafting()), false);
    }

    @Override
    public CuratedFields smelt(PlayerEvent.ItemSmeltedEvent e) {
        return atPlayer(e.getEntity(), itemId(e.getSmelting()), false);
    }

    @Override
    public CuratedFields open(PlayerContainerEvent.Open e) {
        return atPlayer(e.getEntity(), menu(e.getContainer()), false);
    }

    @Override
    public CuratedFields close(PlayerContainerEvent.Close e) {
        return atPlayer(e.getEntity(), menu(e.getContainer()), false);
    }

    private static CuratedFields atBlock(LevelAccessor level, BlockPos pos, Player p, String what, boolean cancelled) {
        return new CuratedFields(pos.getX(), pos.getY(), pos.getZ(), name(p), what, world(level), cancelled);
    }

    private static CuratedFields atPlayer(Player p, String what, boolean cancelled) {
        BlockPos pos = p.blockPosition();
        return new CuratedFields(pos.getX(), pos.getY(), pos.getZ(), name(p), what, world(p.level()), cancelled);
    }

    private static String name(Player p) {
        return p.getGameProfile().name();
    }

    private static String world(LevelAccessor level) {
        return level instanceof Level l ? l.dimension().identifier().toString() : null;
    }

    private static String blockId(BlockState state) {
        return state.getBlock().builtInRegistryHolder().key().identifier().toString();
    }

    private static String itemId(ItemStack stack) {
        return stack.getItem().builtInRegistryHolder().key().identifier().toString();
    }

    /** The menu class name: bounded, and unlike the menu type it exists for the player's own inventory menu. */
    private static String menu(AbstractContainerMenu menu) {
        String n = menu.getClass().getSimpleName();
        return n.length() > NAME_CAP ? n.substring(0, NAME_CAP) : n;
    }
}
