package dev.geldar.core.lakitu;

import java.util.Optional;

/** A read-only lookup of agent positions. There is no setter, mover or creator here (invariants I1, I2). */
public interface AgentRegistry {
    /** One agent's position; angles in degrees. */
    record AgentPosition(String agentId, double x, double y, double z, float yaw, float pitch, boolean onGround) {}

    Optional<AgentPosition> position(String agentId);
}
