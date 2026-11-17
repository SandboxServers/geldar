package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.enchantment.EnchantItemEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.inventory.FurnaceExtractEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerHarvestBlockEvent;
import org.bukkit.event.player.PlayerItemBreakEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;

/**
 * Blocks and items (PT-07a). Fields, in ring order: l1,l2,l3 = block x,y,z (for an item event, the block the actor is
 * in); s1 = {@code geldar.life_id} (only a life id, never a player name); s2 = the material key
 * ({@code geldar.block} or {@code geldar.item}, a cached enum name, never an item display name); s3 = world name.
 *
 * <p>Every event is registered with {@code ignoreCancelled=true}: a cancelled break or place did not happen. Nothing
 * here reads item meta, inventory contents, addresses or text.
 */
public final class BlocksItemsFamily implements CuratedFamily {
    private static final String[] BLOCK_FIELDS = {
        AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.BLOCK, AttrKeys.WORLD
    };
    private static final String[] ITEM_FIELDS = {
        AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.ITEM, AttrKeys.WORLD
    };
    private static final String B = Names.Events.BLOCK_FAMILY + ".";
    private static final String I = Names.Events.ITEM_FAMILY + ".";

    @Override
    public void register(CuratedRegistry r) {
        r.on(BlockBreakEvent.class, B + "break", Severity.INFO, BLOCK_FIELDS, true, (e, s) ->
                atBlock(s, e.getPlayer(), e.getBlock(), e.getBlock()));
        r.on(BlockPlaceEvent.class, B + "place", Severity.INFO, BLOCK_FIELDS, true, (e, s) -> {
            if (e instanceof BlockMultiPlaceEvent) { // delivered to this executor through the shared handler list
                s.skip();
                return;
            }
            atBlock(s, e.getPlayer(), e.getBlockPlaced(), e.getBlockPlaced());
        });
        r.on(BlockMultiPlaceEvent.class, B + "multi_place", Severity.INFO, BLOCK_FIELDS, true, (e, s) ->
                atBlock(s, e.getPlayer(), e.getBlockPlaced(), e.getBlockPlaced()));
        r.on(PlayerHarvestBlockEvent.class, B + "harvest", Severity.INFO, BLOCK_FIELDS, true, (e, s) ->
                atBlock(s, e.getPlayer(), e.getHarvestedBlock(), e.getHarvestedBlock()));
        r.on(PlayerBucketEmptyEvent.class, B + "bucket_empty", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atBlock(s, e.getPlayer(), e.getBlockClicked(), null);
            s.s2 = e.getBucket().name();
        });
        r.on(PlayerBucketFillEvent.class, B + "bucket_fill", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atBlock(s, e.getPlayer(), e.getBlockClicked(), null);
            s.s2 = e.getBucket().name();
        });
        r.on(PlayerItemConsumeEvent.class, I + "consume", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atEntity(s, e.getPlayer());
            s.s2 = e.getItem().getType().name();
        });
        r.on(PlayerItemBreakEvent.class, I + "break", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atEntity(s, e.getPlayer());
            s.s2 = e.getBrokenItem().getType().name();
        });
        r.on(CraftItemEvent.class, I + "craft", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            if (!(e.getWhoClicked() instanceof Player p)) {
                s.skip();
                return;
            }
            atEntity(s, p);
            s.s2 = e.getRecipe().getResult().getType().name();
        });
        r.on(FurnaceExtractEvent.class, I + "furnace_extract", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atBlock(s, e.getPlayer(), e.getBlock(), null);
            s.s2 = e.getItemType().name();
        });
        r.on(EnchantItemEvent.class, I + "enchant", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atBlock(s, e.getEnchanter(), e.getEnchantBlock(), null);
            s.s2 = e.getItem().getType().name();
        });
        r.on(EntityPickupItemEvent.class, I + "pickup", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            if (!(e.getEntity() instanceof Player p)) {
                s.skip();
                return;
            }
            atEntity(s, p);
            s.s2 = e.getItem().getItemStack().getType().name();
        });
        r.on(PlayerDropItemEvent.class, I + "drop", Severity.INFO, ITEM_FIELDS, true, (e, s) -> {
            atEntity(s, e.getPlayer());
            s.s2 = e.getItemDrop().getItemStack().getType().name();
        });
    }

    /** Position and world from a block; the material name from {@code material} when given. */
    private static void atBlock(FieldSink s, Player p, Block at, Block material) {
        s.player(p);
        s.block(at.getX(), at.getY(), at.getZ());
        s.s3 = at.getWorld().getName();
        if (material != null) {
            s.s2 = material.getType().name();
        }
    }

    /** Position (rounded down to the block) and world from the acting player. */
    private static void atEntity(FieldSink s, Player p) {
        Entity e = p;
        s.player(p);
        s.at(e.getX(), e.getY(), e.getZ());
        s.s3 = e.getWorld().getName();
    }
}
