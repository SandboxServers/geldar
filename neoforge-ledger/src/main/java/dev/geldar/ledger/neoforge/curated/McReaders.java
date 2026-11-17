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
    public boolean wantsBreak(BreakBlockEvent e) {
        return !e.getLevel().isClientSide(); // fires on both sides
    }

    @Override
    public boolean wantsPlace(BlockEvent.EntityPlaceEvent e) {
        return isServerPlayer(e.getLevel().isClientSide(), e.getEntity());
    }

    /** The pure placement filter: server side and a player (an enderman is not). */
    static boolean isServerPlayer(boolean clientSide, Object entity) {
        return !clientSide && entity instanceof Player;
    }

    @Override
    public CuratedFields breakBlock(BreakBlockEvent e) {
        return atBlock(e.getLevel(), e.getPos(), e.getPlayer(), blockId(e.getState()), e.isCanceled());
    }

    @Override
    public CuratedFields place(BlockEvent.EntityPlaceEvent e) {
        if (!(e.getEntity() instanceof Player p)) {
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
        return noPosition(e.getEntity(), menu(e.getContainer()));
    }

    @Override
    public CuratedFields close(PlayerContainerEvent.Close e) {
        return noPosition(e.getEntity(), menu(e.getContainer()));
    }

    private static CuratedFields atBlock(LevelAccessor level, BlockPos pos, Player p, String what, boolean cancelled) {
        return block(pos, name(p), what, world(level), cancelled);
    }

    /** The pure mapping of a block position to fields (x to x, y to y, z to z). */
    static CuratedFields block(BlockPos pos, String player, String what, String world, boolean cancelled) {
        return new CuratedFields(pos.getX(), pos.getY(), pos.getZ(), player, what, world, cancelled);
    }

    private static CuratedFields atPlayer(Player p, String what, boolean cancelled) {
        BlockPos pos = p.blockPosition();
        return new CuratedFields(pos.getX(), pos.getY(), pos.getZ(), name(p), what, world(p.level()), cancelled);
    }

    /** Container events: the position slots are skipped at registration, so these zeros are never emitted. */
    private static CuratedFields noPosition(Player p, String what) {
        return new CuratedFields(0, 0, 0, name(p), what, world(p.level()), false);
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
        return menuName(menu.getClass().getSimpleName());
    }

    /** Empty (anonymous or lambda class) becomes the fixed {@code unknown}; the rest is capped at 48 characters. */
    static String menuName(String simple) {
        if (simple == null || simple.isEmpty()) {
            return "unknown";
        }
        return simple.length() > NAME_CAP ? simple.substring(0, NAME_CAP) : simple;
    }
}
