package dev.geldar.ledger.core;

/**
 * The frozen metric and event names of README section 4, one nested class per owner card. Collectors reference these
 * constants; they never retype a name. A name not listed in the README is added there first.
 *
 * <p>Event families written {@code geldar.block.*} in the README appear here as the family prefix
 * ({@code BLOCK_FAMILY = "geldar.block"}); the concrete event names are fixed by the owning card.
 */
public final class Names {
    private Names() {}

    /** PT-03d. */
    public static final class Queue {
        public static final String DROPPED_TOTAL = "geldar_ledger_dropped_total";
        public static final String DEPTH = "geldar_ledger_queue_depth";

        private Queue() {}
    }

    /** PT-03e. */
    public static final class Guard {
        public static final String COLLECTOR_DISABLED = "geldar_paper_collector_disabled";
        public static final String COLLECTOR_TIME_US = "geldar_ledger_collector_time_us";

        private Guard() {}
    }

    /** PT-04b. */
    public static final class Tick {
        public static final String LAG_MS = "geldar_tick_lag_ms";
        public static final String OVERRUNS_TOTAL = "geldar_tick_overruns_total";
        public static final String STALLS_TOTAL = "geldar_tick_stalls_total";
        public static final String TPS = "geldar_tps";
        public static final String RATE_TARGET = "geldar_tick_rate_target";
        public static final String FROZEN = "geldar_tick_frozen";

        private Tick() {}
    }

    /** PT-04c. */
    public static final class Spark {
        public static final String TPS = "geldar_spark_tps";
        public static final String MSPT_MS = "geldar_spark_mspt_ms";
        public static final String CPU_RATIO = "geldar_spark_cpu_ratio";
        public static final String GC_MS = "geldar_spark_gc_ms";

        private Spark() {}
    }

    /** PT-05a. */
    public static final class World {
        public static final String LOADED_CHUNKS = "geldar_world_loaded_chunks";
        public static final String ENTITIES = "geldar_world_entities";
        public static final String PLAYERS = "geldar_world_players";
        public static final String TICK_MS = "geldar_world_tick_ms";

        private World() {}
    }

    /** PT-05b. */
    public static final class Server {
        public static final String PLAYERS_ONLINE = "geldar_players_online";
        public static final String OPERATORS_COUNT = "geldar_operators_count";
        public static final String PLUGINS_ENABLED = "geldar_plugins_enabled";
        public static final String SCHEDULER_PENDING_TASKS = "geldar_scheduler_pending_tasks";
        /** NeoForge only: the count of loaded mods (no names or versions). */
        public static final String MODS_LOADED = "geldar_mods_loaded";

        private Server() {}
    }

    /** PT-06a, PT-06c. */
    public static final class Census {
        public static final String EVENT_COUNT_TOTAL = "geldar_event_count_total";
        public static final String EVENT_DUTY_RATIO = "geldar_event_duty_ratio";

        private Census() {}
    }

    /** PT-09b. */
    public static final class Jfr {
        public static final String THREAD_GROUP_CPU_RATIO = "geldar_jfr_thread_group_cpu_ratio";
        public static final String SAFEPOINT_MS = "geldar_jfr_safepoint_ms";
        public static final String MONITOR_CONTENTION_TOTAL = "geldar_jfr_monitor_contention_total";
        public static final String FILE_IO_MS = "geldar_jfr_file_io_ms";
        public static final String EXCEPTIONS_TOTAL = "geldar_jfr_exceptions_total";

        private Jfr() {}
    }

    /** PT-09c. */
    public static final class Container {
        public static final String CPU_PERIODS_TOTAL = "geldar_container_cpu_periods_total";
        public static final String CPU_THROTTLED_PERIODS_TOTAL = "geldar_container_cpu_throttled_periods_total";
        public static final String CPU_THROTTLED_SECONDS_TOTAL = "geldar_container_cpu_throttled_seconds_total";
        public static final String MEMORY_BYTES = "geldar_container_memory_bytes";
        public static final String MEMORY_LIMIT_BYTES = "geldar_container_memory_limit_bytes";

        private Container() {}
    }

    /** PT-10a. */
    public static final class Disk {
        public static final String BYTES = "geldar_disk_bytes";

        private Disk() {}
    }

    /** PT-10b. */
    public static final class Bridge {
        public static final String CHUNKY_RUNNING = "geldar_bridge_chunky_running";
        public static final String COREPROTECT_ENABLED = "geldar_bridge_coreprotect_enabled";
        public static final String BLUEMAP_ENABLED = "geldar_bridge_bluemap_enabled";

        private Bridge() {}
    }

    /** PT-11e: Geldar-Core metric name prefixes (the concrete names are fixed by that card). */
    public static final class CorePrefix {
        public static final String PUBLISHER = "geldar_publisher_";
        public static final String HEARING = "geldar_hearing_";
        public static final String BLOCKOWNER = "geldar_blockowner_";
        public static final String KINO = "geldar_kino_";

        private CorePrefix() {}
    }

    /** Event names and families (OTel log records; {@code event.name} is the attribute). */
    public static final class Events {
        public static final String PLAYER_JOIN = "geldar.player.join";
        public static final String PLAYER_QUIT = "geldar.player.quit";
        public static final String PLAYER_KICK = "geldar.player.kick";
        public static final String PLAYER_PRELOGIN = "geldar.player.prelogin";
        public static final String PLAYER_SNAPSHOT = "geldar.player.snapshot";
        public static final String PLAYER_ADVANCEMENT = "geldar.player.advancement";
        public static final String PLAYER_STATS = "geldar.player.stats";
        public static final String PLAYER_CLIENT_TICK = "geldar.player.client_tick";
        public static final String PLAYER_COMMAND_TREE = "geldar.player.command_tree";
        public static final String SERVER_SLOW_TICK = "geldar.server.slow_tick";
        public static final String SERVER_STALL = "geldar.server.stall";
        public static final String SERVER_CONFIG_SNAPSHOT = "geldar.server.config_snapshot";
        public static final String SERVER_EXCEPTION = "geldar.server.exception";
        public static final String SERVER_PLUGIN_ENABLED = "geldar.server.plugin_enabled";
        public static final String SERVER_PLUGIN_DISABLED = "geldar.server.plugin_disabled";
        public static final String COLLECTOR_DISABLED = "geldar.collector.disabled";
        public static final String TRADE = "geldar.trade";
        public static final String CHAT = "geldar.chat";
        public static final String SIGN = "geldar.sign";
        public static final String BOOK = "geldar.book";
        public static final String RCON_COMMAND = "geldar.rcon.command";
        public static final String CONSOLE_COMMAND = "geldar.console.command";
        public static final String BROADCAST = "geldar.broadcast";
        public static final String TABCOMPLETE = "geldar.tabcomplete";
        public static final String VELOCITY_LOGIN = "geldar.velocity.login";
        public static final String VELOCITY_DISCONNECT = "geldar.velocity.disconnect";

        // Families written geldar.<family>.* in the README.
        public static final String BLOCK_FAMILY = "geldar.block";
        public static final String ITEM_FAMILY = "geldar.item";
        public static final String CONTAINER_FAMILY = "geldar.container";
        public static final String SLEEP_FAMILY = "geldar.sleep";
        public static final String ANIMAL_FAMILY = "geldar.animal";
        public static final String COMBAT_FAMILY = "geldar.combat";
        public static final String MOVEMENT_FAMILY = "geldar.movement";
        public static final String WHITELIST_FAMILY = "geldar.whitelist";
        public static final String RAID_FAMILY = "geldar.raid";

        private Events() {}
    }
}
