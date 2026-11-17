package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import io.papermc.paper.event.player.PlayerDeepSleepEvent;
import io.papermc.paper.event.player.PlayerTradeEvent;
import java.util.Locale;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.AbstractVillager;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.entity.EntityBreedEvent;
import org.bukkit.event.entity.EntityTameEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerBedLeaveEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerShearEntityEvent;

/**
 * Containers, sleep, animals and trade (PT-07b). Fields, in ring order: l1,l2,l3 = a rounded block position (the
 * container, the bed, or the acting player's block); s1 = {@code geldar.life_id} (only a life id, never a player name);
 * s2 = one bounded enum or registry key name (the attribute key differs per event, see below); s3 = world name.
 *
 * <p>s2 per event: container open/close = {@code InventoryType} name ({@code geldar.container_type}); sleep enter =
 * {@code BedEnterResult} name, every result including denials; trade, breed, tame, shear and fish are in {@code geldar.subtype}: trade = villager profession key (upper case, capped) or
 * the entity type for a non-villager trader; breed/tame/shear = the animal's {@code EntityType} name; fish = the
 * {@code PlayerFishEvent.State} name; sleep leave and deep sleep carry no s2. All of these are enum or registry names:
 * none is free text.
 *
 * <p>Never read: inventory contents, item meta, custom names of animals or villagers, trade items, addresses, display
 * names. Players only: an event whose actor is not a {@link Player} records nothing. Sleep enter is registered with
 * {@code ignoreCancelled=false} (a denied entry is the data); every other event uses {@code ignoreCancelled=true}.
 */
public final class ContainersSleepAnimalsFamily implements CuratedFamily {
    private static final int NAME_CAP = 48;
    private static final String[] CONTAINER_FIELDS = {
        AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.CONTAINER_TYPE, AttrKeys.WORLD
    };
    private static final String[] RESULT_FIELDS = {
        AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.RESULT, AttrKeys.WORLD
    };
    private static final String[] SUBTYPE_FIELDS = {
        AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE, AttrKeys.WORLD
    };
    private static final String[] PLAIN_FIELDS = {AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.WORLD};
    private static final String C = Names.Events.CONTAINER_FAMILY + ".";
    private static final String S = Names.Events.SLEEP_FAMILY + ".";
    private static final String A = Names.Events.ANIMAL_FAMILY + ".";

    @Override
    public void register(CuratedRegistry r) {
        r.on(InventoryOpenEvent.class, C + "open", Severity.INFO, CONTAINER_FIELDS, true, (e, s) -> {
            if (!(e.getPlayer() instanceof Player p)) {
                s.skip();
                return;
            }
            container(s, p, e.getInventory().getLocation(), e.getInventory().getType().name());
        });
        r.on(InventoryCloseEvent.class, C + "close", Severity.INFO, CONTAINER_FIELDS, true, (e, s) -> {
            if (!(e.getPlayer() instanceof Player p)) {
                s.skip();
                return;
            }
            container(s, p, e.getInventory().getLocation(), e.getInventory().getType().name());
        });
        // A denied entry is the data: ignoreCancelled=false, every result name recorded.
        r.on(PlayerBedEnterEvent.class, S + "enter", Severity.INFO, RESULT_FIELDS, false, (e, s) -> {
            atBlock(s, e.getPlayer(), e.getBed());
            s.s2 = e.getBedEnterResult().name();
        });
        r.on(PlayerBedLeaveEvent.class, S + "leave", Severity.INFO, PLAIN_FIELDS, true, (e, s) ->
                atBlock(s, e.getPlayer(), e.getBed()));
        r.on(PlayerDeepSleepEvent.class, S + "deep", Severity.INFO, PLAIN_FIELDS, true, (e, s) ->
                atPlayer(s, e.getPlayer()));
        r.on(PlayerTradeEvent.class, Names.Events.TRADE, Severity.INFO, SUBTYPE_FIELDS, true, (e, s) -> {
            atPlayer(s, e.getPlayer());
            AbstractVillager v = e.getVillager();
            s.s2 = v instanceof Villager vil ? bounded(vil.getProfession().key().value()) : v.getType().name();
        });
        r.on(EntityBreedEvent.class, A + "breed", Severity.INFO, SUBTYPE_FIELDS, true, (e, s) -> {
            if (!(e.getBreeder() instanceof Player p)) {
                s.skip();
                return;
            }
            atPlayer(s, p);
            s.s2 = e.getEntity().getType().name();
        });
        r.on(EntityTameEvent.class, A + "tame", Severity.INFO, SUBTYPE_FIELDS, true, (e, s) -> {
            if (!(e.getOwner() instanceof Player p)) {
                s.skip();
                return;
            }
            atPlayer(s, p);
            s.s2 = e.getEntity().getType().name();
        });
        r.on(PlayerShearEntityEvent.class, A + "shear", Severity.INFO, SUBTYPE_FIELDS, true, (e, s) -> {
            atPlayer(s, e.getPlayer());
            s.s2 = e.getEntity().getType().name();
        });
        r.on(PlayerFishEvent.class, Names.Events.ITEM_FAMILY + ".fish", Severity.INFO, SUBTYPE_FIELDS, true, (e, s) -> {
            atPlayer(s, e.getPlayer());
            s.s2 = e.getState().name();
        });
    }

    /**
     * Container position from its location (zeros when the inventory has none), world from the location or else the
     * player, and the container type name. Takes plain values so a test needs no inventory.
     */
    static void container(FieldSink s, Player p, Location at, String type) {
        s.player(p);
        s.s2 = type;
        if (at == null) {
            s.block(0, 0, 0);
            s.s3 = p.getWorld().getName();
            return;
        }
        s.block(at.getBlockX(), at.getBlockY(), at.getBlockZ());
        s.s3 = at.getWorld() != null ? at.getWorld().getName() : p.getWorld().getName();
    }

    private static void atBlock(FieldSink s, Player p, Block at) {
        s.player(p);
        s.block(at.getX(), at.getY(), at.getZ());
        s.s3 = at.getWorld().getName();
    }

    private static void atPlayer(FieldSink s, Player p) {
        s.player(p);
        s.at(p.getX(), p.getY(), p.getZ());
        s.s3 = p.getWorld().getName();
    }

    /** A registry key as an upper-case name, capped; the only non-enum string here, still never player text. */
    static String bounded(String key) {
        if (key == null) {
            return null;
        }
        String up = key.toUpperCase(Locale.ROOT);
        return up.length() > NAME_CAP ? up.substring(0, NAME_CAP) : up;
    }
}
