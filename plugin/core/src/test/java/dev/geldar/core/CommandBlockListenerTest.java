package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.logging.Logger;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.junit.jupiter.api.Test;

class CommandBlockListenerTest {
    @Test
    void playerCommandIsCancelled() {
        Player player = ListenerDoubles.player("ag_wren_02", List.of(), new java.util.ArrayList<>());
        PlayerCommandPreprocessEvent event = new PlayerCommandPreprocessEvent(player, "/gamemode creative");

        new CommandBlockListener(Logger.getLogger("test")).onCommand(event);

        assertTrue(event.isCancelled());
    }
}