package dev.geldar.ledger.neoforge;

import java.util.function.BiConsumer;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.slf4j.LoggerFactory;

/**
 * The ledger's logger. ledger-core logs through {@code java.util.logging}, which the dedicated server leaves on stderr
 * (it misses {@code logs/latest.log}); this forwards every record to the server's SLF4J logger instead. Only the
 * formatted message is forwarded, never the record's thrown object.
 */
public final class LedgerLog {
    private static final Logger SERVER = serverLogger();

    private LedgerLog() {}

    /** The shared logger for mod code and ledger-core; its records reach the server log. */
    public static Logger server() {
        return SERVER;
    }

    /**
     * SLF4J is on the server's classpath (a NeoForge dependency, compile-time here) but not on the unit-test runtime
     * classpath; without it the plain java.util.logging logger is used.
     */
    private static Logger serverLogger() {
        try {
            return forSink(slf4jSink());
        } catch (LinkageError e) {
            return Logger.getLogger("ledger");
        }
    }

    /** A logger whose records go only to {@code sink} (level, message); a throwing sink never reaches the caller. */
    static Logger forSink(BiConsumer<Level, String> sink) {
        Logger logger = Logger.getAnonymousLogger();
        logger.setUseParentHandlers(false);
        logger.setLevel(Level.ALL);
        logger.addHandler(new Handler() {
            @Override
            public void publish(LogRecord r) {
                try {
                    sink.accept(r.getLevel(), r.getMessage());
                } catch (RuntimeException e) {
                    // logging must not break the caller
                }
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        return logger;
    }

    private static BiConsumer<Level, String> slf4jSink() {
        org.slf4j.Logger log = LoggerFactory.getLogger("ledger");
        return (level, msg) -> {
            int v = level.intValue();
            if (v >= Level.SEVERE.intValue()) {
                log.error("{}", msg);
            } else if (v >= Level.WARNING.intValue()) {
                log.warn("{}", msg);
            } else if (v >= Level.INFO.intValue()) {
                log.info("{}", msg);
            } else {
                log.debug("{}", msg);
            }
        };
    }
}
