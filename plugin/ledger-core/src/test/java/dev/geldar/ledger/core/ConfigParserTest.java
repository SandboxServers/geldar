package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Properties;
import org.junit.jupiter.api.Test;

class ConfigParserTest {
    private static ConfigParser.ParseResult parse(String... kv) {
        Properties p = new Properties();
        for (int i = 0; i < kv.length; i += 2) {
            p.setProperty(kv[i], kv[i + 1]);
        }
        return ConfigParser.parse(p);
    }

    @Test
    void emptyFileGivesDefaults() {
        ConfigParser.ParseResult r = parse();
        assertTrue(r.ok());
        LedgerConfig c = r.config();
        assertEquals(LedgerConfig.defaults(), c);
        assertTrue(c.enabled());
        assertTrue(c.collectorEnabled("anything"));
        assertEquals(50, c.budgetAvgUs("x"));
        assertEquals(250, c.budgetMaxUs("x"));
        assertEquals(20, c.rateFor("geldar.chat"));
        assertEquals(4096, c.queueCapacityFor("events"));
        assertEquals(32768, c.contentMaxBytes());
        assertEquals(2000, c.stallThresholdMs());
        assertEquals(200, c.sampleWorldEveryTicks());
        assertEquals(20, c.samplePlayerEveryTicks());
        assertFalse(c.jfrEnabled(), "JFR is off unless the config turns it on");
        assertNull(c.dutyFor("PlayerMoveEvent"));
    }

    @Test
    void masterOffTurnsEveryCollectorOff() {
        LedgerConfig c = parse("enabled", "false", "collector.tick.enabled", "true").config();
        assertFalse(c.collectorEnabled("tick"));
        assertFalse(c.collectorEnabled("other"));
        assertFalse(LedgerConfig.disabled().collectorEnabled("tick"));
    }

    @Test
    void allKeysParse() {
        LedgerConfig c = parse(
                        "collector.tick.enabled", "false",
                        "collector.tick.budget_avg_us", "70",
                        "collector.tick.budget_max_us", "300",
                        "collector.census.duty.PlayerMoveEvent", "2/10",
                        "rate.geldar.chat", "5",
                        "queue.events.capacity", "64",
                        "content.max_bytes", "1000",
                        "stall.threshold_ms", "3000",
                        "sample.world_every_ticks", "100",
                        "sample.player_every_ticks", "40",
                        "jfr.enabled", "false")
                .config();
        assertNotNull(c);
        assertFalse(c.collectorEnabled("tick"));
        assertTrue(c.collectorEnabled("spark"));
        assertEquals(70, c.budgetAvgUs("tick"));
        assertEquals(300, c.budgetMaxUs("tick"));
        assertEquals(new LedgerConfig.Duty(2, 10), c.dutyFor("PlayerMoveEvent"));
        assertEquals(5, c.rateFor("geldar.chat"));
        assertEquals(64, c.queueCapacityFor("events"));
        assertEquals(1000, c.contentMaxBytes());
        assertEquals(3000, c.stallThresholdMs());
        assertEquals(100, c.sampleWorldEveryTicks());
        assertEquals(40, c.samplePlayerEveryTicks());
        assertFalse(c.jfrEnabled());
    }

    @Test
    void unknownKeyRejected() {
        ConfigParser.ParseResult r = parse("colour", "red");
        assertFalse(r.ok());
        assertNull(r.config());
        assertTrue(r.errors().get(0).contains("unknown key: colour"));
    }

    @Test
    void credentialKeysRejectTheWholeFileAndAppliesNothing() {
        for (String key : new String[] {"rcon_password", "RCON.PASSWORD", "api.token", "x.secret", "my.key", "http.Authorization"}) {
            ConfigParser.ParseResult r = parse("enabled", "false", key, "hunter2");
            assertFalse(r.ok(), key);
            assertNull(r.config(), key);
            assertEquals(1, r.errors().size(), key);
            assertTrue(r.errors().get(0).startsWith("credential-looking key rejected: "), key);
            for (String e : r.errors()) {
                assertFalse(e.contains("hunter2"), "value must never be reported");
            }
        }
    }

    @Test
    void outOfRangeAndMalformedValuesRejected() {
        assertFalse(parse("queue.events.capacity", "63").ok());
        assertFalse(parse("queue.events.capacity", "65537").ok());
        assertTrue(parse("queue.events.capacity", "65536").ok());
        assertFalse(parse("content.max_bytes", "32769").ok());
        assertFalse(parse("content.max_bytes", "0").ok());
        assertFalse(parse("enabled", "yes").ok());
        assertFalse(parse("stall.threshold_ms", "abc").ok());
        assertFalse(parse("collector.census.duty.PlayerMoveEvent", "11/10").ok());
        assertFalse(parse("collector.census.duty.PlayerMoveEvent", "3").ok());
        assertFalse(parse("collector.census.duty.PlayerMoveEvent", "0/0").ok());
        assertFalse(parse("rate.chat", "5").ok());
        assertFalse(parse("rate.geldar.chat", "-1").ok());
    }

    @Test
    void oneBadKeyAppliesNothingFromTheRest() {
        ConfigParser.ParseResult r = parse("enabled", "false", "bogus", "1");
        assertNull(r.config());
    }

    @Test
    void goodPathsAreAccepted() {
        ConfigParser.ParseResult r = parse("disk.area.world.path", "world", "disk.area.logs.path", "/srv/mc/logs", "container.cgroup_root", "/sys/fs/cgroup");
        assertTrue(r.ok());
        assertEquals("world", r.config().diskAreaPath("world"));
        assertEquals("/srv/mc/logs", r.config().diskAreaPath("logs"));
    }

    @Test
    void pathsWithSecretDotDotOrNulAreRejectedWithoutEchoingTheValue() {
        String[] bad = {
            "/run/secrets", "/data/SeCrEt/x", "secret", "/a/mysecretdir", "../world", "a/../b", "a\\..\\b", "..", "/x/..",
            "wor\u0000ld"
        };
        for (String v : bad) {
            ConfigParser.ParseResult r = parse("disk.area.world.path", v);
            assertFalse(r.ok(), "disk path " + v.replace('\u0000', '0'));
            assertEquals(1, r.errors().size());
            assertTrue(r.errors().get(0).length() < 120, "bounded");
            assertFalse(r.errors().get(0).toLowerCase().contains("secrets"), "value is not echoed");
            assertFalse(parse("container.cgroup_root", v).ok(), "cgroup root " + v.replace('\u0000', '0'));
        }
    }

    @Test
    void dotsInsideANameAreNotADotDotSegment() {
        assertTrue(parse("disk.area.world.path", "a..b/c...d").ok());
    }
}