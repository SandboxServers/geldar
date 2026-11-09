package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.ArrayList;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
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

    @Test
    void theLoggedMessageIsTruncatedAndFlattened() {
        Logger log = Logger.getAnonymousLogger();
        log.setUseParentHandlers(false);
        List<String> lines = new ArrayList<>();
        log.addHandler(new Handler() {
            @Override
            public void publish(LogRecord record) {
                lines.add(record.getMessage());
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        Player player = ListenerDoubles.player("ag_wren_02", List.of(), new ArrayList<>());
        String hostile = "/say " + "x".repeat(5_000) + "\nforged line";

        new CommandBlockListener(log).onCommand(new PlayerCommandPreprocessEvent(player, hostile));

        assertEquals(1, lines.size());
        assertTrue(lines.get(0).length() < 250, lines.get(0).length() + " chars logged");
        assertTrue(lines.get(0).contains("(" + hostile.length() + " chars)"));
        assertEquals("/a b", CommandBlockListener.clip("/a\nb"));
    }
}