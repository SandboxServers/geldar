package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;

/**
 * The curated events of PT-N7, with the Paper event names and field order (l1,l2,l3 = x,y,z; s1 = life id; s2 = the
 * kind's name attribute; s3 = world). A cancelled break or place is recorded as its own {@code _cancelled} event, so
 * it is marked and never dropped.
 */
enum CuratedKind {
    BREAK(Names.Events.BLOCK_FAMILY + ".break", AttrKeys.BLOCK),
    BREAK_CANCELLED(Names.Events.BLOCK_FAMILY + ".break_cancelled", AttrKeys.BLOCK),
    PLACE(Names.Events.BLOCK_FAMILY + ".place", AttrKeys.BLOCK),
    PLACE_CANCELLED(Names.Events.BLOCK_FAMILY + ".place_cancelled", AttrKeys.BLOCK),
    CRAFT(Names.Events.ITEM_FAMILY + ".craft", AttrKeys.ITEM),
    SMELT(Names.Events.ITEM_FAMILY + ".smelt", AttrKeys.ITEM),
    CONTAINER_OPEN(Names.Events.CONTAINER_FAMILY + ".open", AttrKeys.CONTAINER_TYPE),
    CONTAINER_CLOSE(Names.Events.CONTAINER_FAMILY + ".close", AttrKeys.CONTAINER_TYPE);

    final String eventName;
    final String[] fieldNames;

    CuratedKind(String eventName, String nameKey) {
        this.eventName = eventName;
        this.fieldNames = new String[] {AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, nameKey, AttrKeys.WORLD};
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
