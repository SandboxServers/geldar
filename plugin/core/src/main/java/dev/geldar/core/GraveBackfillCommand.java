package dev.geldar.core;

import dev.geldar.core.GraveBackfill.SignSite;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.World;

/**
 * {@code /geldar-backfill-graves}: records the gravestones already standing in loaded chunks as owned by the system
 * (decision 0195), for those placed before the recording existed. Console only: a player (even an operator) is refused,
 * so no human acts in the world through it. Unloaded chunks are not scanned; that is an offline region scan, out of
 * scope for decision 0195. Runs on the server thread, as the command executor always does.
 */
final class GraveBackfillCommand implements CommandExecutor {
    static final String NAME = "geldar-backfill-graves";

    private final PlacementRecorder placements;

    GraveBackfillCommand(PlacementRecorder placements) {
        this.placements = placements;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender)) {
            sender.sendMessage("geldar-backfill-graves runs from the server console only.");
            return true;
        }
        List<SignSite> sites = new ArrayList<>();
        for (World world : Bukkit.getWorlds()) {
            for (Chunk chunk : world.getLoadedChunks()) {
                for (BlockState state : chunk.getTileEntities()) {
                    if (state instanceof Sign sign) {
                        sites.add(site(sign));
                    }
                }
            }
        }
        int found = GraveBackfill.run(sites, placements);
        sender.sendMessage("Backfilled " + found + " gravestone(s) from " + sites.size()
                + " sign(s) in loaded chunks.");
        return true;
    }

    private static SignSite site(Sign sign) {
        Block block = sign.getBlock();
        List<String> lines = new ArrayList<>();
        for (Component line : sign.getSide(Side.FRONT).lines()) {
            lines.add(PlainTextComponentSerializer.plainText().serialize(line));
        }
        String below = block.getRelative(0, -1, 0).getType().name();
        return new SignSite(block.getWorld().getName(), block.getX(), block.getY(), block.getZ(), below, lines);
    }
}
