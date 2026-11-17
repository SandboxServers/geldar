package dev.geldar.neoforge;

import java.util.concurrent.Executor;
import java.util.function.Consumer;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;

/**
 * The only class that touches the server to say a maintenance line. UNVERIFIED on 26.1: confirm with a GameTest or a
 * first server run. The names relied on are {@code MinecraftServer#execute(Runnable)} (the server thread hand-off),
 * {@code MinecraftServer#getPlayerList()}, {@code PlayerList#broadcastSystemMessage(Component, boolean)} with
 * {@code false} (the system chat line, not the action bar) and {@code Component#literal(String)}. If one of them is
 * missing on 26.1 this file fails to compile, which is the intent.
 */
public final class MaintenanceBroadcast {
    private MaintenanceBroadcast() {}

    /** Runs each task on the server thread, between ticks. Bukkit-style thread rules: nothing is said off it. */
    public static Executor serverThread(MinecraftServer server) {
        return server::execute;
    }

    /** One system line to every connected player; the text is the fixed template line from core-common. */
    public static Consumer<String> systemLine(MinecraftServer server) {
        return text -> server.getPlayerList().broadcastSystemMessage(Component.literal(text), false);
    }
}
