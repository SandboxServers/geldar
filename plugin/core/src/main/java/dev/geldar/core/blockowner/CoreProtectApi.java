package dev.geldar.core.blockowner;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.coreprotect.CoreProtect;
import net.coreprotect.CoreProtectAPI;
import net.coreprotect.CoreProtectAPI.ParseResult;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/**
 * The CoreProtect API v12 as a {@link CoreProtectPort}. Only this class touches net.coreprotect, and it is loaded only
 * when the CoreProtect plugin is present. CoreProtect lookups block on database I/O: callers run them off the server
 * thread.
 */
public final class CoreProtectApi implements CoreProtectPort {
    static final int MIN_API_VERSION = 12;

    private final CoreProtectAPI api;
    private final LookupDebugLog debug;

    private CoreProtectApi(CoreProtectAPI api, LookupDebugLog debug) {
        this.api = api;
        this.debug = debug;
    }

    /** The API when CoreProtect is loaded, its API is enabled and it is version 12 or newer; empty otherwise. */
    public static Optional<CoreProtectApi> connect(Plugin plugin, LookupDebugLog debug) {
        if (!(plugin instanceof CoreProtect coreProtect)) {
            return Optional.empty();
        }
        CoreProtectAPI api = coreProtect.getAPI();
        if (api == null || !api.isEnabled() || api.APIVersion() < MIN_API_VERSION) {
            return Optional.empty();
        }
        return Optional.of(new CoreProtectApi(api, debug));
    }

    @Override
    public List<LogRow> rows(String world, int chunkX, int chunkZ) {
        World bukkitWorld = Bukkit.getWorld(world);
        if (bukkitWorld == null) {
            throw new IllegalStateException("world is not loaded: " + world);
        }
        ChunkLookupCall call = ChunkLookupCall.forChunk(chunkX, chunkZ);
        Location centre = new Location(bukkitWorld, call.centreX(), call.centreY(), call.centreZ());
        if (debug.enabled()) {
            debug.info("performLookup chunk " + chunkX + "," + chunkZ + " in " + world + ": window seconds="
                    + call.seconds() + " actions=" + call.actions() + " radius=" + call.radius() + " centre="
                    + call.centreX() + "," + call.centreY() + "," + call.centreZ() + " user filters="
                    + call.restrictUsers().size() + "/" + call.excludeUsers().size() + " block filters="
                    + call.restrictBlocks().size() + "/" + call.excludeBlocks().size());
        }
        List<String[]> raw = api.performLookup(call.seconds(), call.restrictUsers(), call.excludeUsers(),
                call.restrictBlocks(), call.excludeBlocks(), call.actions(), call.radius(), centre);
        if (raw == null) {
            throw new IllegalStateException("CoreProtect lookup returned no result");
        }
        List<LogRow> rows = new ArrayList<>(raw.size());
        for (int i = 0; i < raw.size(); i++) {
            ParseResult p = api.parseResult(raw.get(i));
            if (p == null) {
                debug.info("raw row " + i + ": not parsed");
                continue;
            }
            if (debug.enabled()) {
                debug.info(describe(i, p));
            }
            // The lookup is centred in the queried world and the API 12 result carries no world accessor, so the
            // queried world is the row's world.
            rows.add(new LogRow(world, p.getX(), p.getY(), p.getZ(),
                    p.getActionId() == ChunkLookupCall.ACTION_PLACE, p.getPlayer(), p.isRolledBack()));
        }
        return rows;
    }

    /** One raw row for the debug log: its index, action, rollback flag, user kind, block type and position. No name. */
    private static String describe(int index, ParseResult p) {
        String user = FirstRowResolver.isPlayer(p.getPlayer()) ? "player" : "system";
        return "raw row " + index + ": action=" + p.getActionId() + " rolledBack=" + p.isRolledBack() + " user=" + user
                + " block=" + p.getType() + " at " + p.getX() + "," + p.getY() + "," + p.getZ();
    }
}
