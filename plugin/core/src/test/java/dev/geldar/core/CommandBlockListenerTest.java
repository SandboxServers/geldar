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

    @Test
    void unicodeControlAndFormatCharactersAreFlattened() {
        // U+2028 line separator, U+0085 next line, U+202E right-to-left override, U+200B zero width space.
        assertEquals("/a b c d e", CommandBlockListener.clip("/a\u2028b\u0085c\u202Ed\u200Be"));
    }

    @Test
    void aFloodOfCommandsIsAllCancelledButOnlyTheFirstFewAreLogged() {
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
        long[] clock = {0};
        CommandBlockListener listener = new CommandBlockListener(log, () -> clock[0]);
        Player player = ListenerDoubles.player("ag_wren_02", List.of(), new ArrayList<>());

        int total = CommandBlockListener.MAX_LOGGED_PER_WINDOW + 5;
        for (int i = 0; i < total; i++) {
            PlayerCommandPreprocessEvent event = new PlayerCommandPreprocessEvent(player, "/x" + i);
            listener.onCommand(event);
            assertTrue(event.isCancelled());
        }
        assertEquals(CommandBlockListener.MAX_LOGGED_PER_WINDOW, lines.size());

        clock[0] = CommandBlockListener.WINDOW_NANOS;
        listener.onCommand(new PlayerCommandPreprocessEvent(player, "/later"));
        assertEquals(CommandBlockListener.MAX_LOGGED_PER_WINDOW + 2, lines.size());
        assertTrue(lines.get(CommandBlockListener.MAX_LOGGED_PER_WINDOW).startsWith("5 blocked commands"));
    }
}
