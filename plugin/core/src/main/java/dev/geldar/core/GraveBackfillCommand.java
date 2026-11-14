package dev.geldar.core;

import dev.geldar.core.GraveBackfill.ChunkRef;
import dev.geldar.core.GraveBackfill.SignSite;
import dev.geldar.core.GraveBackfill.Tally;
import dev.geldar.core.blockowner.OwnerSource;
import dev.geldar.core.blockowner.PlacementRecorder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.Plugin;

/**
 * {@code /geldar-backfill-graves}: records the gravestones already standing in loaded chunks as owned by the system
 * (decision 0195), for those placed before the recording existed. Console or RCON only: a player (even an operator) is
 * refused, so no human acts in the world through it. RCON is operator-only, as the console is. Unloaded chunks are not scanned; that is an offline region scan, out
 * of scope for decision 0195.
 *
 * <p>The signs are read on the server thread. The owner lookups run off it, one per chunk, at most
 * {@link GraveBackfill#MAX_CHUNKS} chunks. The recording and the reply run back on the server thread. A run that is still
 * going refuses a second one, so two runs cannot both see a block as unowned.
 */
final class GraveBackfillCommand implements CommandExecutor {
    static final String NAME = "geldar-backfill-graves";

    private final Plugin plugin;
    private final PlacementRecorder placements;
    private final OwnerSource owners;
    private final AtomicBoolean running = new AtomicBoolean();

    GraveBackfillCommand(Plugin plugin, PlacementRecorder placements, OwnerSource owners) {
        this.plugin = plugin;
        this.placements = placements;
        this.owners = owners;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!isOperatorSender(sender)) {
            sender.sendMessage("geldar-backfill-graves runs from the server console or RCON only.");
            return true;
        }
        if (!running.compareAndSet(false, true)) {
            sender.sendMessage("geldar-backfill-graves is already running; wait for its reply.");
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
        List<ChunkRef> chunks = GraveBackfill.chunksOf(sites);
        int unchecked = Math.max(0, chunks.size() - GraveBackfill.MAX_CHUNKS);
        List<ChunkRef> checked = chunks.subList(0, chunks.size() - unchecked);
        CompletableFuture.supplyAsync(() -> GraveBackfill.lookUp(owners, checked, plugin.getLogger()))
                .whenComplete((answered, failure) -> plugin.getServer().getScheduler().runTask(plugin,
                        () -> finish(sender, sites, answered, failure, unchecked)));
        return true;
    }

    /** Back on the server thread: records the gravestones and sends the reply. */
    private void finish(CommandSender sender, List<SignSite> sites, Map<ChunkRef, OwnerSource.Owners> answered,
            Throwable failure, int unchecked) {
        running.set(false);
        if (failure != null) {
            sender.sendMessage("geldar-backfill-graves failed: owner lookup did not finish; nothing was recorded.");
            return;
        }
        Tally tally = GraveBackfill.run(sites, placements, GraveBackfill.fromChunks(answered), unchecked);
        sender.sendMessage(GraveBackfill.reply(tally));
    }

    /** The senders allowed to run the backfill: the server console and RCON, both operator-only. */
    static boolean isOperatorSender(CommandSender sender) {
        return sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender;
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
