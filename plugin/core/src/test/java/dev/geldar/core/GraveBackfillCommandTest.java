package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import org.bukkit.command.BlockCommandSender;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

class GraveBackfillCommandTest {

    @Test
    void theConsoleIsAccepted() {
        assertTrue(GraveBackfillCommand.isOperatorSender(sender(ConsoleCommandSender.class)));
    }

    @Test
    void rconIsAccepted() {
        assertTrue(GraveBackfillCommand.isOperatorSender(sender(RemoteConsoleCommandSender.class)));
    }

    @Test
    void aPlayerIsRefusedEvenAnOperator() {
        assertFalse(GraveBackfillCommand.isOperatorSender(sender(Player.class)));
    }

    @Test
    void aCommandBlockIsRefused() {
        assertFalse(GraveBackfillCommand.isOperatorSender(sender(BlockCommandSender.class)));
    }

    @Test
    void anotherSenderTypeIsRefused() {
        assertFalse(GraveBackfillCommand.isOperatorSender(sender(CommandSender.class)));
    }

    /** A sender of exactly the given type; its methods do nothing, as the check never calls them. */
    private static CommandSender sender(Class<? extends CommandSender> type) {
        return (CommandSender) Proxy.newProxyInstance(GraveBackfillCommandTest.class.getClassLoader(),
                new Class<?>[] {type}, (proxy, method, args) -> null);
    }
}
