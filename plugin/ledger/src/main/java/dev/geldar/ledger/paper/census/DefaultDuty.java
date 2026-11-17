package dev.geldar.ledger.paper.census;

import dev.geldar.ledger.core.LedgerConfig;
import java.util.Set;

/**
 * Duty cycles of the high-rate event families of decision 0351. The 5/20 default is an ESTIMATE until PT-06d replaces it
 * with measured rates; {@code collector.census.duty.<Class>=on/period} overrides it (0/0 style values are the config's).
 */
public final class DefaultDuty {
    public static final LedgerConfig.Duty ESTIMATE = new LedgerConfig.Duty(5, 20);

    /** Simple names of the high-rate classes. */
    public static final Set<String> HIGH_RATE = Set.of(
            "GenericGameEvent",
            "EntityAirChangeEvent",
            "PlayerStatisticIncrementEvent",
            "EntityPathfindEvent",
            "EntityTargetEvent",
            "EntityTargetLivingEntityEvent",
            "PlayerMoveEvent",
            "ClientTickEndEvent",
            "EntityExhaustionEvent",
            "BlockFromToEvent",
            "VehicleUpdateEvent",
            "VehicleMoveEvent");

    private DefaultDuty() {}

    /** The default for a class by simple name, or null (always on). */
    public static LedgerConfig.Duty forSimpleName(String simpleName) {
        return HIGH_RATE.contains(simpleName) ? ESTIMATE : null;
    }

    /** A configured duty wins over the default; a label that is a qualified name has no default. */
    public static LedgerConfig.Duty resolve(LedgerConfig config, String label, String simpleName) {
        LedgerConfig.Duty configured = config.dutyFor(label);
        if (configured == null && !label.equals(simpleName)) {
            configured = config.dutyFor(simpleName);
        }
        return configured != null ? configured : forSimpleName(simpleName);
    }
}
