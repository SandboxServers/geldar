package dev.geldar.ledger.neoforge.world;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.util.List;
import java.util.function.Supplier;

/**
 * {@code geldar_world_loaded_chunks}, {@code geldar_world_entities} and {@code geldar_world_players} per dimension
 * (Paper names), from the running counts in {@link WorldCounts}. The counts are approximate: they come from events,
 * not from a server accessor, and are unverified against a live server until the scratch row (PT-N13) is run. A mod that
 * cancels a join after our listener drifts the entity count upward; the zero clamp hides only downward drift. The gauge readers are field reads, so there is no
 * sampling, no guard use and nothing for an async thread to touch. On unless {@code collector.world.enabled=false} or
 * the master is off.
 */
public final class WorldCollector implements Collector {
    public static final String ID = "world";

    private final WorldCounts counts;
    private final Supplier<List<String>> dimensions;

    /** {@code dimensions} is read once at start (main thread): the loaded dimensions' names. */
    public WorldCollector(WorldCounts counts, Supplier<List<String>> dimensions) {
        this.counts = counts;
        this.dimensions = dimensions;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public void start(CollectorContext ctx) {
        Ledger l = ctx.ledger();
        if (!l.config().collectorEnabled(ID)) {
            return;
        }
        for (String d : dimensions.get()) {
            counts.track(d);
        }
        for (String d : counts.names()) {
            String key = AttrKeys.M_WORLD;
            l.gaugeLong(Names.World.LOADED_CHUNKS, "{chunk}", "Loaded chunks in a world (approximate running count from load and unload events, unverified)", counts.reader(d, WorldCounts.CHUNKS), key, d);
            l.gaugeLong(Names.World.ENTITIES, "{entity}", "Entities in a world (approximate running count from join and leave events, unverified)", counts.reader(d, WorldCounts.ENTITIES), key, d);
            l.gaugeLong(Names.World.PLAYERS, "{player}", "Players in a world (approximate running count from join and leave events)", counts.reader(d, WorldCounts.PLAYERS), key, d);
        }
    }

    @Override
    public void stop() {}
}