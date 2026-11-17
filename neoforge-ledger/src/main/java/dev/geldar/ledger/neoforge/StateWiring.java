package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;

/** PT-N4b: installs the world, server and snapshot wirings, each on its own so one failing never skips the others. */
final class StateWiring {
    private StateWiring() {}

    static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        LedgerMod.isolated("world", () -> dev.geldar.ledger.neoforge.world.WorldWiring.install(ledger, host, scheduler));
        LedgerMod.isolated("server", () -> dev.geldar.ledger.neoforge.server.ServerWiring.install(ledger, host, scheduler));
        LedgerMod.isolated("snapshot", () -> dev.geldar.ledger.neoforge.players.SnapshotWiring.install(ledger, host, scheduler));
    }
}