package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.jupiter.api.Test;

class CoreConfigTest {
    @Test
    void environmentOverridesFileAndDefaultsApply() {
        YamlConfiguration file = new YamlConfiguration();
        file.set("nats.url", "nats://file:4222");
        file.set("shard", "fromfile");

        CoreConfig fromFile = CoreConfig.load(file, k -> null);
        assertEquals("nats://file:4222", fromFile.natsUrl());
        assertEquals("fromfile", fromFile.shard());

        Map<String, String> env = Map.of("GELDAR_NATS_URL", "nats://env:4222", "GELDAR_SHARD", "phase0");
        CoreConfig fromEnv = CoreConfig.load(file, env::get);
        assertEquals("nats://env:4222", fromEnv.natsUrl());
        assertEquals("phase0", fromEnv.shard());

        CoreConfig defaults = CoreConfig.load(new YamlConfiguration(), k -> null);
        assertEquals(CoreConfig.DEFAULT_NATS_URL, defaults.natsUrl());
        assertEquals(10_000, defaults.queueCapacity());
    }

    @Test
    void shardNamesThatAreNotSubjectTokensFailAtLoad() {
        for (String bad : new String[] {"a", "Phase0", "phase.0", "phase 0", "0phase", "x*", ">", "a".repeat(33)}) {
            Map<String, String> env = Map.of("GELDAR_SHARD", bad);
            assertThrows(IllegalArgumentException.class, () -> CoreConfig.load(new YamlConfiguration(), env::get), bad);
        }
        assertEquals("phase0", CoreConfig.load(new YamlConfiguration(), k -> null).shard());
    }
}