package dev.geldar.ledger.neoforge.curated;

import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;

/** Containers (VERIFIED events only): menu open and close. Never reads contents. */
final class ContainersFamily {
    private ContainersFamily() {}

    static void register(Bus bus, CuratedCollector c, Readers r) {
        bus.listen(PlayerContainerEvent.Open.class, e -> c.handle(CuratedKind.CONTAINER_OPEN, () -> r.open(e)));
        bus.listen(PlayerContainerEvent.Close.class, e -> c.handle(CuratedKind.CONTAINER_CLOSE, () -> r.close(e)));
    }
}
