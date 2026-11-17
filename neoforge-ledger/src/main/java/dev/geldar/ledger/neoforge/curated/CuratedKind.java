package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;

/**
 * The curated events of PT-N7 (field order l1,l2,l3 = x,y,z; s1 = life id; s2 = the kind's name attribute; s3 = world).
 * Positions: break and place carry the block; craft and smelt carry the acting player's block (as Paper craft);
 * container open and close carry NO position (their slots are skipped): the menu does not expose its location safely,
 * and the player's own position would be misread as the container's. Names: break, place, craft and container.open and
 * close match Paper; smelt, break_cancelled and place_cancelled exist only here (Paper has furnace_extract and drops
 * cancelled events). A cancelled break or place is recorded as its own twin, so it is marked and never dropped.
 */
enum CuratedKind {
    BREAK(Names.Events.BLOCK_FAMILY + ".break", AttrKeys.BLOCK),
    BREAK_CANCELLED(Names.Events.BLOCK_FAMILY + ".break_cancelled", AttrKeys.BLOCK),
    PLACE(Names.Events.BLOCK_FAMILY + ".place", AttrKeys.BLOCK),
    PLACE_CANCELLED(Names.Events.BLOCK_FAMILY + ".place_cancelled", AttrKeys.BLOCK),
    CRAFT(Names.Events.ITEM_FAMILY + ".craft", AttrKeys.ITEM),
    SMELT(Names.Events.ITEM_FAMILY + ".smelt", AttrKeys.ITEM),
    CONTAINER_OPEN(Names.Events.CONTAINER_FAMILY + ".open", AttrKeys.CONTAINER_TYPE, false),
    CONTAINER_CLOSE(Names.Events.CONTAINER_FAMILY + ".close", AttrKeys.CONTAINER_TYPE, false);

    final String eventName;
    final String[] fieldNames;

    /** The never-emitted twin registered at rate 0, so a pre-read rate denial is counted by the core drop counter. */
    final String dropName;

    CuratedKind(String eventName, String nameKey) {
        this(eventName, nameKey, true);
    }

    CuratedKind(String eventName, String nameKey, boolean positioned) {
        this.eventName = eventName;
        this.dropName = eventName + "._rate_drop";
        this.fieldNames = positioned
                ? new String[] {AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, nameKey, AttrKeys.WORLD}
                : new String[] {null, null, null, AttrKeys.LIFE_ID, nameKey, AttrKeys.WORLD};
    }

    /** The cancelled twin of a break or place; every other kind has none. */
    CuratedKind whenCancelled() {
        return switch (this) {
            case BREAK -> BREAK_CANCELLED;
            case PLACE -> PLACE_CANCELLED;
            default -> this;
        };
    }
}
