package dev.geldar.core.blockowner;

import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.logging.Logger;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Wires block ownership: the CoreProtect owner source (when CoreProtect is present), the lookup thread, the chunk
 * cache, the change listener, the batched change publisher and the NATS query link. Settings: {@code blockowner.enabled}
 * (default true; false stops the listener and the replies) and {@code blockowner.lookup_timeout_ms} (default 2000).
 */
public final class BlockOwnerSetup implements AutoCloseable {
    static final String COREPROTECT = "CoreProtect";
    static final int LOOKUP_QUEUE = 32;
    static final long DEFAULT_TIMEOUT_MS = 2_000L;
    static final long MIN_TIMEOUT_MS = 100L;
    static final long MAX_TIMEOUT_MS = 60_000L;

    private final ExecutorService lookups;
    private final NatsBlockOwnerLink link;
    private final OwnerQueryService service;
    private volatile boolean enabled = true;

    private BlockOwnerSetup(ExecutorService lookups, NatsBlockOwnerLink link, OwnerQueryService service) {
        this.lookups = lookups;
        this.link = link;
        this.service = service;
    }

    /** Starts the feature; call from {@code onEnable}. The config is read again by {@link #reload}. */
    public static BlockOwnerSetup register(JavaPlugin plugin, String natsUrl, String shard,
            Function<String, String> env) {
        Logger log = plugin.getLogger();
        OwnerSource source = sourceFor(plugin.getServer().getPluginManager().getPlugin(COREPROTECT), log);
        ExecutorService lookups = new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(LOOKUP_QUEUE), r -> {
                    Thread t = new Thread(r, "geldar-blockowner-lookup");
                    t.setDaemon(true);
                    return t;
                });
        OwnerCache cache = new OwnerCache(System::currentTimeMillis);
        OwnerQueryService service = new OwnerQueryService(source, cache, lookups, DEFAULT_TIMEOUT_MS, log);
        NatsBlockOwnerLink link = new NatsBlockOwnerLink(natsUrl, shard, env, log);
        BlockOwnerPublisher publisher = new BlockOwnerPublisher(link::changed, log);
        BlockOwnerSetup setup = new BlockOwnerSetup(lookups, link, service);
        BlockOwnerResponder responder = new BlockOwnerResponder(service, link, () -> setup.enabled);
        link.start(responder::receive);
        plugin.getServer().getPluginManager().registerEvents(
                new BlockChangeListener(cache, publisher, () -> setup.enabled), plugin);
        plugin.getServer().getScheduler().runTaskTimer(plugin, publisher::flush, 1L, 1L);
        setup.reload(plugin.getConfig());
        return setup;
    }

    /** Applies {@code blockowner.*} from the config; the plugin calls it with the 5 s config reload. */
    public void reload(FileConfiguration config) {
        enabled = config.getBoolean("blockowner.enabled", true);
        long timeout = config.getLong("blockowner.lookup_timeout_ms", DEFAULT_TIMEOUT_MS);
        service.setTimeoutMs(Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout)));
    }

    /** The owner source: CoreProtect when it is loaded, enabled and new enough; otherwise one that always says unknown. */
    static OwnerSource sourceFor(Plugin coreProtect, Logger log) {
        if (coreProtect == null) {
            log.warning("CoreProtect is not installed: block owner queries answer unknown; placements are not recorded.");
            return unavailable("CoreProtect is not installed");
        }
        Optional<CoreProtectApi> api = CoreProtectApi.connect(coreProtect);
        if (api.isEmpty()) {
            log.warning("CoreProtect's API is disabled or older than version 12: block owner queries answer unknown.");
            return unavailable("CoreProtect's API is not usable");
        }
        return new CoreProtectOwnerSource(api.get());
    }

    private static OwnerSource unavailable(String reason) {
        return (world, chunkX, chunkZ) -> {
            throw new OwnerSource.Unavailable(reason);
        };
    }

    @Override
    public void close() {
        lookups.shutdownNow();
        link.close();
    }
}
