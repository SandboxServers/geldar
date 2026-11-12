package dev.geldar.core;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;

/**
 * Places a gravestone (a stone-brick block with a standing sign) near where an agent character dies.
 * It holds no items and touches no drops, XP, inventory or respawn (decision 0147). Ordinary blocks:
 * players can break them. Config: {@code gravestones.enabled}, {@code gravestones.max_per_chunk}.
 */
public final class GravestoneListener implements Listener {
    static final String AGENT_PREFIX = "ag_";

    private final boolean enabled;
    private final int maxPerChunk;
    private final Logger log;
    /** Gravestones placed this run per chunk; not persisted, so a restart only makes the cap looser. */
    private final Map<String, Integer> perChunk = new HashMap<>();

    public GravestoneListener(boolean enabled, int maxPerChunk, Logger log) {
        this.enabled = enabled;
        this.maxPerChunk = maxPerChunk;
        this.log = log;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (!enabled || !player.getName().startsWith(AGENT_PREFIX)) {
            return;
        }
        try {
            place(player);
        } catch (RuntimeException e) {
            // A gravestone must never disturb a death.
            log.log(Level.WARNING, "gravestone not placed", e);
        }
    }

    private void place(Player player) {
        World world = player.getWorld();
        if (world.getEnvironment() != World.Environment.NORMAL) {
            return;
        }
        Location at = player.getLocation();
        Optional<Gravestone.Spot> spot = Gravestone.findSpot(new WorldGrid(world), at.getBlockX(), at.getBlockY(), at.getBlockZ());
        if (spot.isEmpty()) {
            log.fine("no safe gravestone spot near the death of " + player.getName());
            return;
        }
        Gravestone.Spot s = spot.get();
        String chunk = world.getName() + ":" + (s.x() >> 4) + ":" + (s.z() >> 4);
        if (perChunk.getOrDefault(chunk, 0) >= maxPerChunk) {
            log.fine("gravestone skipped: chunk " + chunk + " is at its cap");
            return;
        }
        EntityDamageEvent last = player.getLastDamageCause();
        String[] lines = Gravestone.lines(player.getName(), Gravestone.dayOf(world.getFullTime()),
                Gravestone.causeWord(last == null ? null : last.getCause().name()));
        world.getBlockAt(s.x(), s.y(), s.z()).setType(Material.STONE_BRICKS);
        Block signBlock = world.getBlockAt(s.x(), s.y() + 1, s.z());
        signBlock.setType(Material.OAK_SIGN);
        if (signBlock.getState() instanceof Sign sign) {
            for (int i = 0; i < lines.length; i++) {
                sign.getSide(Side.FRONT).line(i, Component.text(lines[i]));
            }
            sign.update();
        }
        perChunk.merge(chunk, 1, Integer::sum);
    }

    /** The live world seen through the pure search's grid. */
    private record WorldGrid(World world) implements Gravestone.Grid {
        @Override
        public boolean isAir(int x, int y, int z) {
            return y >= world.getMinHeight() && y < world.getMaxHeight() && world.getBlockAt(x, y, z).getType().isAir();
        }

        @Override
        public boolean isSolid(int x, int y, int z) {
            return y >= world.getMinHeight() && world.getBlockAt(x, y, z).getType().isSolid();
        }

        @Override
        public boolean isLiquid(int x, int y, int z) {
            return y >= world.getMinHeight() && world.getBlockAt(x, y, z).isLiquid();
        }
    }
}
