package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Properties;
import org.junit.jupiter.api.Test;

class ConfigKeysTest {
    private static ConfigParser.ParseResult parse(String... kv) {
        Properties p = new Properties();
        for (int i = 0; i < kv.length; i += 2) {
            p.setProperty(kv[i], kv[i + 1]);
        }
        return ConfigParser.parse(p);
    }

    @Test
    void cgroupRootDefaultsAndIsParsed() {
        assertEquals("/sys/fs/cgroup", LedgerConfig.defaults().cgroupRoot());
        assertEquals("/sys/fs/cgroup", parse().config().cgroupRoot());
        assertEquals("/tmp/cg", parse("container.cgroup_root", "/tmp/cg").config().cgroupRoot());
        assertFalse(parse("container.cgroup_root", "").ok());
        assertFalse(parse("container.cgroup_root", "x".repeat(257)).ok());
    }

    @Test
    void diskAreaPathsAreParsedForTheFixedAreasOnly() {
        LedgerConfig c = parse("disk.area.world.path", "world", "disk.area.chunky.path", "plugins/Chunky").config();
        assertEquals("world", c.diskAreaPath("world"));
        assertEquals("plugins/Chunky", c.diskAreaPath("chunky"));
        assertNull(c.diskAreaPath("logs"));
        assertNull(c.diskAreaPath(null));
        for (String a : new String[] {"world", "plugin_data", "logs", "bluemap", "chunky"}) {
            assertTrue(parse("disk.area." + a + ".path", "p").ok(), a);
        }
        assertFalse(parse("disk.area.etc.path", "/etc").ok());
        assertFalse(parse("disk.area.world.path", "").ok());
    }

    @Test
    void twelveArgConstructorStillWorksAndNullIdsAreSafe() {
        LedgerConfig d = LedgerConfig.defaults();
        assertFalse(d.collectorEnabled(null) && !d.enabled());
        assertFalse(d.collectorEnabled(null));
        assertEquals(d.withEnabled(false), LedgerConfig.disabled());
    }

    @Test
    void hostileKeyNamesAreSanitisedInErrors() {
        ConfigParser.ParseResult r = parse("a\nWARNING forged " + "z".repeat(200), "1");
        assertFalse(r.ok());
        String e = r.errors().get(0);
        assertFalse(e.contains("\n"));
        assertTrue(e.length() < 100);
    }
}
