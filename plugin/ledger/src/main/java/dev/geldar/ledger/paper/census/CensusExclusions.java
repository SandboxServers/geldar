package dev.geldar.ledger.paper.census;

import java.util.Set;

/** Event classes the census must never register, by simple name, plus the deprecated rule (S10). */
public final class CensusExclusions {
    /** The 14 gated classes of decision 0351 point 3, the legacy chat events and the login event. */
    public static final Set<String> NAMES = Set.of(
            "BlockPhysicsEvent",
            "EntityMoveEvent",
            "InventoryMoveItemEvent",
            "HopperInventorySearchEvent",
            "PlayerChunkLoadEvent",
            "PlayerChunkUnloadEvent",
            "PlayerTrackEntityEvent",
            "PlayerUntrackEntityEvent",
            "BlockDestroyEvent",
            "PlayerInventorySlotChangeEvent",
            "PlayerRecipeBookClickEvent",
            "PlayerSignOpenEvent",
            "ItemTransportingEntityValidateTargetEvent",
            "AsyncPlayerConnectionConfigureEvent",
            "AsyncPlayerChatEvent",
            "PlayerChatEvent",
            "PlayerLoginEvent");

    private CensusExclusions() {}

    /** True when the class is named in {@link #NAMES} or is annotated {@code @Deprecated}. */
    public static boolean isExcluded(Class<?> type) {
        return NAMES.contains(type.getSimpleName()) || type.isAnnotationPresent(Deprecated.class);
    }
}
