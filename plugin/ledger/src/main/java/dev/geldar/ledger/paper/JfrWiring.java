package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.jfr.ContentionHandler;
import dev.geldar.ledger.core.jfr.ExceptionHandler;
import dev.geldar.ledger.core.jfr.FileIoHandler;
import dev.geldar.ledger.core.jfr.JfrHandler;
import dev.geldar.ledger.core.jfr.JfrRunner;
import dev.geldar.ledger.core.jfr.SafepointHandler;
import dev.geldar.ledger.core.jfr.ThreadCpuHandler;
import java.util.List;
import java.util.function.BiFunction;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Starts and stops the JFR runner from the config key {@code jfr.enabled} (default false). The runner is bounded (30 s,
 * 8 MiB, the JfrSettings allow list) and fails safe: no JFR means one log line and nothing else. Main thread only.
 */
final class JfrWiring {
    /** Starts a runner for the given ledger and config; replaced by tests. */
    interface Starter extends BiFunction<Ledger, LedgerConfig, JfrRunner> {}

    private final Logger log;
    private final Starter starter;
    private JfrRunner runner;

    JfrWiring(Logger log) {
        this(log, (ledger, config) -> JfrRunner.start(handlers(ledger), config, log));
    }

    JfrWiring(Logger log, Starter starter) {
        this.log = log;
        this.starter = starter;
    }

    static List<JfrHandler> handlers(Ledger ledger) {
        return List.of(
                new ThreadCpuHandler(ledger),
                new SafepointHandler(ledger),
                new ContentionHandler(ledger),
                new FileIoHandler(ledger),
                new ExceptionHandler(ledger));
    }

    /** Applies a config snapshot: starts once when jfr.enabled turns on, stops when it turns off. Never throws. */
    void sync(LedgerConfig config, Ledger ledger) {
        try {
            boolean want = config.enabled() && config.jfrEnabled();
            if (!want) {
                stop();
            } else if (runner == null) {
                runner = starter.apply(ledger, config);
            }
        } catch (Throwable t) {
            runner = null;
            log.log(Level.WARNING, "JFR wiring failed; JFR metrics are off", t);
        }
    }

    /** Idempotent. */
    void stop() {
        JfrRunner r = runner;
        runner = null;
        if (r != null) {
            try {
                r.stop();
            } catch (Throwable t) {
                log.log(Level.FINE, "JFR runner stop failed", t);
            }
        }
    }

    boolean started() {
        return runner != null;
    }
}
