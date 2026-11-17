package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.HostInfo;
import org.bukkit.Server;

/** {@link HostInfo} over a Paper {@link Server}. */
final class PaperHostInfo implements HostInfo {
    private final Server server;

    PaperHostInfo(Server server) {
        this.server = server;
    }

    @Override
    public long serverTick() {
        return server.getCurrentTick();
    }

    @Override
    public boolean isMainThread() {
        return server.isPrimaryThread();
    }

    @Override
    public String loaderName() {
        return "paper";
    }
}
