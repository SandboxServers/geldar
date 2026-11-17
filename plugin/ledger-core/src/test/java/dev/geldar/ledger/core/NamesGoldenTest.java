package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Pins every name in {@link Names} to the README section 4 tables (frozen literal lists). */
class NamesGoldenTest {
    private static final Set<String> METRICS = Set.of(
            "geldar_tick_lag_ms", "geldar_tick_overruns_total", "geldar_tick_stalls_total", "geldar_tps",
            "geldar_tick_rate_target", "geldar_tick_frozen", "geldar_spark_tps", "geldar_spark_mspt_ms",
            "geldar_spark_cpu_ratio", "geldar_spark_gc_ms", "geldar_world_loaded_chunks", "geldar_world_entities",
            "geldar_world_players", "geldar_world_tick_ms", "geldar_players_online", "geldar_operators_count",
            "geldar_plugins_enabled",
            "geldar_scheduler_pending_tasks", "geldar_event_count_total", "geldar_event_duty_ratio",
            "geldar_paper_collector_disabled", "geldar_ledger_collector_time_us", "geldar_ledger_dropped_total",
            "geldar_ledger_queue_depth", "geldar_jfr_thread_group_cpu_ratio", "geldar_jfr_safepoint_ms",
            "geldar_jfr_monitor_contention_total", "geldar_jfr_file_io_ms", "geldar_jfr_exceptions_total",
            "geldar_container_cpu_periods_total", "geldar_container_cpu_throttled_periods_total",
            "geldar_container_cpu_throttled_seconds_total", "geldar_container_memory_bytes",
            "geldar_container_memory_limit_bytes", "geldar_disk_bytes", "geldar_bridge_chunky_running",
            "geldar_bridge_coreprotect_enabled", "geldar_bridge_bluemap_enabled", "geldar_publisher_", "geldar_hearing_",
            "geldar_blockowner_", "geldar_kino_");

    private static final Set<String> EVENTS = Set.of(
            "geldar.player.join", "geldar.player.quit", "geldar.player.kick", "geldar.player.prelogin",
            "geldar.player.snapshot", "geldar.player.advancement", "geldar.player.stats", "geldar.server.slow_tick",
            "geldar.server.stall", "geldar.server.config_snapshot", "geldar.server.exception",
            "geldar.server.plugin_enabled", "geldar.server.plugin_disabled", "geldar.collector.disabled",
            "geldar.trade", "geldar.chat", "geldar.sign", "geldar.book", "geldar.rcon.command",
            "geldar.console.command", "geldar.broadcast", "geldar.tabcomplete", "geldar.velocity.login",
            "geldar.velocity.disconnect", "geldar.block", "geldar.item", "geldar.container", "geldar.sleep",
            "geldar.animal", "geldar.combat", "geldar.movement", "geldar.whitelist", "geldar.raid");

    private static Set<String> constants(Class<?> c) throws IllegalAccessException {
        Set<String> out = new HashSet<>();
        for (Field f : c.getFields()) {
            if (Modifier.isStatic(f.getModifiers()) && f.getType() == String.class) {
                out.add((String) f.get(null));
            }
        }
        return out;
    }

    @Test
    void metricNamesEqualTheReadmeTable() throws IllegalAccessException {
        Set<String> found = new HashSet<>();
        int count = 0;
        for (Class<?> nested : Names.class.getClasses()) {
            if (nested != Names.Events.class) {
                Set<String> s = constants(nested);
                count += s.size();
                found.addAll(s);
            }
        }
        assertEquals(42, METRICS.size());
        assertEquals(METRICS, found);
        assertEquals(METRICS.size(), count, "no duplicate constant");
    }

    @Test
    void eventNamesEqualTheReadmeList() throws IllegalAccessException {
        assertEquals(EVENTS, constants(Names.Events.class));
    }

    @Test
    void everyNameFollowsTheNameRules() {
        for (String m : METRICS) {
            if (!m.endsWith("_")) {
                assertEquals(m, NameRules.requireMetricName(m));
            }
        }
        for (String e : EVENTS) {
            assertEquals(e, NameRules.requireEventName(e));
        }
    }
}
