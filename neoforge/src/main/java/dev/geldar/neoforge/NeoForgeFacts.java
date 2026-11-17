package dev.geldar.neoforge;

import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;

/**
 * The one place that reads Minecraft and NeoForge accessors for the export. Event class names and the
 * {@code getInflictedDamage}, {@code getSource}, {@code getProblem} and {@code getTickCount} accessors were read from
 * the cached NeoForge 26.1.2 build 126 jars with javap; the rest are the names the compiler checks against that build.
 * UNVERIFIED on 26.1: confirm the runtime value with a GameTest or a first server run. The three that carry
 * a runtime meaning are: the profile name is the username the server sees (P0 open item); the dimension id string
 * is {@code minecraft:overworld} and its siblings; and a null {@code CanPlayerSleepEvent.getProblem()} means the bed
 * is usable.
 */
final class NeoForgeFacts {
    private NeoForgeFacts() {}

    /** The username the server sees, which is the offline-mode UUID's name for a Body (see p0-findings.md). */
    static String playerName(ServerPlayer player) {
        return player.getGameProfile().name();
    }

    /** The death or damage cause in Paper's words, from the vanilla damage type's message id. */
    static String causeOf(DamageSource source) {
        return EventMapping.causeOf(source == null ? null : source.getMsgId());
    }

    static EventMapping.Pos blockPos(ServerPlayer player) {
        BlockPos at = player.blockPosition();
        return new EventMapping.Pos(at.getX(), at.getY(), at.getZ());
    }

    /** The dimension id, such as {@code minecraft:the_nether}; EventMapping maps it to the contract's words. */
    static String dimensionId(ServerPlayer player) {
        return player.level().dimension().identifier().toString();
    }

    static long serverTick(MinecraftServer server) {
        return server.getTickCount();
    }

    static int playerCount(MinecraftServer server) {
        return server.getPlayerList().getPlayerCount();
    }
}
