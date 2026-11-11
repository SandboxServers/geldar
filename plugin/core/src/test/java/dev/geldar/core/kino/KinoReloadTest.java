package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class KinoReloadTest {
    private final List<String> out = new ArrayList<>();
    private final KinoSink sink = (agent, json) -> out.add(json);

    private static YamlConfiguration cfg(boolean on) {
        YamlConfiguration y = new YamlConfiguration();
        y.set("kino.enabled", on);
        return y;
    }

    @Test
    void reloadingWithTheSwitchOffStopsPublishingAndOnAllowsStarts() {
        KinoFeed feed = new KinoFeed(new FakeWorld(Set.of(FakeWorld.key(0, 0))), sink, 1);
        assertTrue(feed.start("steve_bot"));
        out.clear();
        KinoSetup.reload(feed, cfg(false));
        assertEquals(1, out.size());
        assertTrue(out.get(0).contains("kill_switch"));
        out.clear();
        feed.tick();
        assertFalse(feed.start("steve_bot"));
        assertTrue(out.isEmpty());
        KinoSetup.reload(feed, cfg(true));
        assertTrue(feed.start("steve_bot"));
    }
}
