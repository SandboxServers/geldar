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

    private CoreProtectApi(CoreProtectAPI api) {
        this.api = api;
    }

    /** The API when CoreProtect is loaded, its API is enabled and it is version 12 or newer; empty otherwise. */
    public static Optional<CoreProtectApi> connect(Plugin plugin) {
        if (!(plugin instanceof CoreProtect coreProtect)) {
            return Optional.empty();
        }
        CoreProtectAPI api = coreProtect.getAPI();
        if (api == null || !api.isEnabled() || api.APIVersion() < MIN_API_VERSION) {
            return Optional.empty();
        }
        return Optional.of(new CoreProtectApi(api));
    }

    @Override
    public List<LogRow> rows(String world, int chunkX, int chunkZ) {
        World bukkitWorld = Bukkit.getWorld(world);
        if (bukkitWorld == null) {
            throw new IllegalStateException("world is not loaded: " + world);
        }
        ChunkLookupCall call = ChunkLookupCall.forChunk(chunkX, chunkZ);
        Location centre = new Location(bukkitWorld, call.centreX(), call.centreY(), call.centreZ());
        List<String[]> raw = api.performLookup(call.seconds(), call.restrictUsers(), call.excludeUsers(),
                call.restrictBlocks(), call.excludeBlocks(), call.actions(), call.radius(), centre);
        if (raw == null) {
            throw new IllegalStateException("CoreProtect lookup returned no result");
        }
        List<LogRow> rows = new ArrayList<>(raw.size());
        for (String[] line : raw) {
            ParseResult p = api.parseResult(line);
            if (p == null) {
                continue;
            }
            // The lookup is centred in the queried world and the API 12 result carries no world accessor, so the
            // queried world is the row's world.
            rows.add(new LogRow(world, p.getX(), p.getY(), p.getZ(),
                    p.getActionId() == ChunkLookupCall.ACTION_PLACE, p.getPlayer(), p.isRolledBack()));
        }
        return rows;
    }
}
