package dev.geldar.core.lakitu;

import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Reads an online agent's position by name through getters only. An offline agent has no position. */
public final class BukkitAgentRegistry implements AgentRegistry {
    private final Server server;

    public BukkitAgentRegistry(Server server) {
        this.server = server;
    }

    @Override
    public Optional<AgentPosition> position(String agentId) {
        Player player = server.getPlayerExact(agentId);
        if (player == null) {
            return Optional.empty();
        }
        Location at = player.getLocation();
        return Optional.of(new AgentPosition(agentId, at.getX(), at.getY(), at.getZ(), at.getYaw(),
                Math.max(-90f, Math.min(90f, at.getPitch())), player.isOnGround()));
    }
}
