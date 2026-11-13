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
    /** CoreProtect's action ids: 0 is a break, 1 a place. */
    static final int ACTION_BREAK = 0;
    static final int ACTION_PLACE = 1;
    /** Ten years in seconds: the window is "seconds back" and every row of the columns is wanted. */
    static final int LOOKUP_SECONDS = 315_360_000;
    /** CoreProtect's radius is an inclusive square around the centre; 8 from the chunk middle covers its 16 columns. */
    static final int RADIUS = 8;
    private static final int CENTRE_Y = 64;

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
        Location centre = new Location(bukkitWorld, chunkX * 16 + 8.0, CENTRE_Y, chunkZ * 16 + 8.0);
        List<String[]> raw = api.performLookup(LOOKUP_SECONDS, null, null, null, null,
                List.of(ACTION_BREAK, ACTION_PLACE), RADIUS, centre);
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
                    p.getActionId() == ACTION_PLACE, p.getPlayer(), p.isRolledBack()));
        }
        return rows;
    }
}
